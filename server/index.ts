import crypto from 'crypto'
import http from 'http'
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { Server, LobbyRoom } from 'colyseus'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { monitor } from '@colyseus/monitor'
import { RoomType } from '../types/Rooms'
import { spawn, ChildProcess } from 'child_process'

// import socialRoutes from "@colyseus/social/express"

import { SkyOffice, getAttendanceForDate } from './rooms/SkyOffice'
import { registerDoc, readDoc, writeDoc, hydrate, setLocalBlobDir, setLocalBackupDir, putBlob, getBlob, status as storageStatus } from './storage'
import { startBackups, getBackupList, readBackup, restoreBackup, backupNow } from './backup'
import { startFileCleanup, getUsage, deleteFileManually } from './cleanup'

const port = Number(process.env.PORT || 2567)
const app = express()

app.use(cors())
app.use(express.json())

import fs from 'fs'
import path from 'path'

// クライアントのビルドファイル（dist）を静的配信
// ts-node(__dirname=server/)・コンパイル済みJS(__dirname=server/lib/)・CWD違いに対応
const CLIENT_DIST = [
  path.join(__dirname, '..', 'client', 'dist'),        // ts-node: server/index.ts
  path.join(__dirname, '..', '..', 'client', 'dist'),  // compiled: server/lib/index.js
  path.join(process.cwd(), 'client', 'dist'),          // cwd = project root
].find(p => fs.existsSync(p)) || path.join(__dirname, '..', 'client', 'dist')
console.log(`[Static] Serving client from: ${CLIENT_DIST}`)
app.use(express.static(CLIENT_DIST))


// 勤怠記録取得API（?date=YYYY-MM-DD、省略時は今日）
app.get('/api/attendance', (req, res) => {
  const date = (req.query.date as string) || new Date().toISOString().slice(0, 10)
  res.json(getAttendanceForDate(date))
})

// client/public/assets/audio/ フォルダ内のmp3ファイルを動的にスキャンして返すAPI
app.get('/api/audio-list', (req, res) => {
  const audioDir = path.join(__dirname, '../client/public/assets/audio')
  try {
    if (fs.existsSync(audioDir)) {
      const files = fs.readdirSync(audioDir)
      const mp3Files = files
        .filter(file => file.toLowerCase().endsWith('.mp3') && file.toLowerCase() !== 'ping.mp3')
        .map(file => ({
          name: file.replace(/\.[^/.]+$/, ""), // 拡張子を削除して曲名に
          url: `assets/audio/${file}`,
          isLocal: false
        }))
      res.json(mp3Files)
    } else {
      res.json([])
    }
  } catch (err) {
    console.error('Failed to read audio directory:', err)
    res.status(500).json({ error: 'Failed to read audio directory' })
  }
})

// 予想ボードAPI（AUTOMATA agent-state.json を優先、なければ静的フォールバック）
app.get('/api/predictions', (req, res) => {
  try {
    const stateFile = path.join(__dirname, 'bots', 'agent-state.json')
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'))
      return res.json(state)
    }

    // フォールバック: bot-runner未起動時
    res.json({ predictions: [], debates: [], consensus: 'AIエージェント未起動', updatedAt: 0 })
  } catch (err) {
    console.error('Predictions API error:', err)
    res.status(500).json({ error: 'Failed to load predictions' })
  }
})

// ミッション（課題）API — ゼミの教授が課題を出す
const MISSION_FILE = path.join(__dirname, 'bots', 'mission.json')

app.get('/api/mission', (req, res) => {
  try {
    if (fs.existsSync(MISSION_FILE)) {
      return res.json(JSON.parse(fs.readFileSync(MISSION_FILE, 'utf-8')))
    }
    res.json({ mission: '', setAt: 0 })
  } catch { res.json({ mission: '', setAt: 0 }) }
})

app.post('/api/mission', (req, res) => {
  try {
    const { mission } = req.body
    if (!mission || typeof mission !== 'string') {
      return res.status(400).json({ error: 'mission is required' })
    }
    const data = { mission: mission.slice(0, 500), setAt: Date.now() }
    fs.writeFileSync(MISSION_FILE, JSON.stringify(data, null, 2), 'utf-8')
    console.log(`[Mission] 新課題: ${data.mission}`)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: 'Failed to save mission' })
  }
})

// ─── ファイルアップロードAPI ──────────────────────────────────────────────────
// ホワイトボードの画像・チャットの添付ファイルをHTTPで送受信するための置き場。
// 大きなbase64をWebSocketに乗せるとメッセージの直列化と順番待ちで
// オフィス全体の同期（移動・チャット含む）までラグが波及するため、
// ファイル本体はHTTP・WebSocketにはURLだけ、という分担にする。

const UPLOADS_DIR = path.join(__dirname, 'uploads')
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024 // 50MB
// 画像などの本体はSupabase Storage（未設定ならUPLOADS_DIR）へ、
// 名前やMIMEなどの索引はJSONドキュメントとして保存する
setLocalBlobDir(UPLOADS_DIR)
setLocalBackupDir(path.join(__dirname, 'backups'))
registerDoc('uploadIndex', path.join(UPLOADS_DIR, 'index.json'))

interface UploadRecord {
  name: string
  type: string
  size: number
  created: number
  // 中身のハッシュ。同じ内容のファイルを二重に保存しないための目印
  hash?: string
}

function loadUploadIndex(): Record<string, UploadRecord> {
  return readDoc<Record<string, UploadRecord>>('uploadIndex', {})
}

function saveUploadIndex(index: Record<string, UploadRecord>) {
  writeDoc('uploadIndex', index)
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE },
})

app.post('/api/files', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' })

    const index = loadUploadIndex()

    // 同じ画像（会社ロゴ・資料など）は何度も貼られる。中身が同じなら保存し直さず、
    // 既にあるファイルのURLを返して使い回す（容量とアップロード時間の両方を節約）。
    const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex')
    const existingId = Object.keys(index).find((k) => index[k]?.hash === hash)
    if (existingId) {
      const rec = index[existingId]
      // 使い回す以上、これは「今使われた」ファイル。日付を更新しないと、
      // 古いという理由で自動削除され、今貼ったものまで見られなくなる
      rec.created = Date.now()
      saveUploadIndex(index)
      console.log(`[Files] 同じ内容が既にあるため使い回します (${existingId}, ${Math.round(rec.size / 1024)}KB)`)
      return res.json({ id: existingId, url: `/files/${existingId}`, name: rec.name, type: rec.type, size: rec.size })
    }

    const id = `f_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    await putBlob(id, req.file.buffer, req.file.mimetype || 'application/octet-stream')

    index[id] = {
      name: (req.file.originalname || 'file').slice(0, 300),
      type: req.file.mimetype || 'application/octet-stream',
      size: req.file.size,
      created: Date.now(),
      hash,
    }
    saveUploadIndex(index)

    res.json({ id, url: `/files/${id}`, name: index[id].name, type: index[id].type, size: index[id].size })
  } catch (e) {
    console.error('[Files] アップロード失敗:', e)
    res.status(500).json({ error: 'upload failed' })
  }
})

// 容量の使用状況。MAP左下のメーターと、ファイルを消す画面が使う
app.get('/api/storage-usage', (req, res) => {
  res.json(getUsage())
})

// 利用者が画面から不要なファイルを消す。使用中のものはサーバー側で拒否する
app.delete('/api/files/:id', async (req, res) => {
  const id = req.params.id
  if (!/^[a-zA-Z0-9_]+$/.test(id)) return res.status(400).json({ error: 'bad id' })
  try {
    const r = await deleteFileManually(id)
    if (!r.ok) {
      const status = r.reason === 'in-use' ? 409 : 404
      return res.status(status).json({ error: r.reason })
    }
    res.json({ ok: true })
  } catch (e) {
    console.error('[Files] 手動削除に失敗:', e)
    res.status(500).json({ error: 'delete failed' })
  }
})

// ─── バックアップ（世代管理） ────────────────────────────────────────────────
// 会議室の内容が壊れたり誤って消されたりしたときに戻せるようにする

app.get('/api/backups', async (req, res) => {
  try {
    res.json(await getBackupList())
  } catch (e) {
    console.error('[Backup] 一覧の取得に失敗:', e)
    res.status(500).json({ error: 'list failed' })
  }
})

// 中身の確認・手元への保存用（戻す前に中身を見られるように）
app.get('/api/backups/:name', async (req, res) => {
  try {
    const snap = await readBackup(req.params.name)
    if (!snap) return res.status(404).json({ error: 'not found' })
    res.json(snap)
  } catch (e) {
    res.status(500).json({ error: 'read failed' })
  }
})

// 指定した世代に戻す。戻す前に今の状態も自動でバックアップされる
app.post('/api/backups/restore', async (req, res) => {
  const { name } = req.body || {}
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required' })
  try {
    const r = await restoreBackup(name)
    if (!r.ok) return res.status(r.reason === 'not-found' ? 404 : 400).json({ error: r.reason })
    res.json({ ok: true })
  } catch (e) {
    console.error('[Backup] 復元に失敗:', e)
    res.status(500).json({ error: 'restore failed' })
  }
})

// 今すぐバックアップを取る（大きな変更の前に手動で残したいとき用）
app.post('/api/backups/now', async (req, res) => {
  try {
    await backupNow('手動')
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'backup failed' })
  }
})

// 保存先が効いているかの確認用。'local' なら再起動でデータが消えるので設定を見直す。
app.get('/api/storage-status', (req, res) => {
  res.json(storageStatus())
})

app.get('/files/:id', async (req, res) => {
  const id = req.params.id
  // idはサーバー生成の英数字のみ。パストラバーサルを防ぐため厳密に検証する
  if (!/^[a-zA-Z0-9_]+$/.test(id)) return res.status(400).end()
  const blob = await getBlob(id)
  if (!blob) return res.status(404).end()

  const meta = loadUploadIndex()[id]
  const type = meta?.type || 'application/octet-stream'
  // HTML/SVGをinlineで返すと保存ファイル経由のXSSが可能になるため必ずダウンロード扱いにする
  const forceAttachment = /text\/html|image\/svg\+xml/i.test(type)
  const encodedName = encodeURIComponent(meta?.name || id)

  res.setHeader('Content-Type', type)
  res.setHeader(
    'Content-Disposition',
    `${forceAttachment ? 'attachment' : 'inline'}; filename*=UTF-8''${encodedName}`
  )
  // idは一意で内容が変わらないため、強くキャッシュさせる（再入室時の画像再取得を無くす）
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  res.send(blob)
})

// 知識DB API（馬データ・調査結果）
app.get('/api/knowledge', (req, res) => {
  try {
    const knowledgeFile = path.join(__dirname, 'bots', 'knowledge.json')
    if (fs.existsSync(knowledgeFile)) {
      return res.json(JSON.parse(fs.readFileSync(knowledgeFile, 'utf-8')))
    }
    res.json({ entries: [], raceData: {}, updatedAt: 0 })
  } catch (err) {
    console.error('Knowledge API error:', err)
    res.status(500).json({ error: 'Failed to load knowledge' })
  }
})

const server = http.createServer(app)
const gameServer = new Server({
  // 画像/動画/PDF等の大きめファイル送信に対応するため maxPayload を拡張（既定100MiB→明示64MB）
  transport: new WebSocketTransport({
    server,
    maxPayload: 64 * 1024 * 1024, // 64MB
    // 切断判定を緩める。既定は 3000ms×2回 ＝ 約6秒無応答で強制切断だったため、
    // WiFiの瞬断・モバイル回線の切替・PCのスリープ復帰・回線の一時的な詰まりで
    // すぐ「接続が切れました」になっていた。約20秒までは待って、TCPが生きていれば
    // そのまま自動回復させる。本当に落ちた相手の検出が20秒に延びるだけで害は小さい。
    pingInterval: 5000,
    pingMaxRetries: 4,
  }),
})

// register room handlers
gameServer.define(RoomType.LOBBY, LobbyRoom)
gameServer.define(RoomType.PUBLIC, SkyOffice, {
  name: 'Public Lobby',
  description: 'For making friends and familiarizing yourself with the controls',
  password: null,
  autoDispose: false,
})
gameServer.define(RoomType.CUSTOM, SkyOffice).enableRealtimeListing()
// 合言葉(roomKey)で固定入室できるルーム。filterByにより、同じroomKeyで
// joinOrCreateすると既存の部屋に合流し、無ければ作られる（URLからの直接入室に使う）。
gameServer.define(RoomType.KEYED, SkyOffice).filterBy(['roomKey'])

/**
 * Register @colyseus/social routes
 *
 * - uncomment if you want to use default authentication (https://docs.colyseus.io/server/authentication/)
 * - also uncomment the import statement
 */
// app.use("/", socialRoutes);

// register colyseus monitor AFTER registering your room handlers
app.use('/colyseus', monitor())

// SPAのクライアント側ルーティング対応（API等以外の全リクエストで index.html を返す）
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/colyseus')) {
    return next()
  }
  res.sendFile(path.join(CLIENT_DIST, 'index.html'))
})

// Render無料枠は15分間HTTPアクセスが無いとスピンダウンし、次に開いた人は
// 50秒前後のコールドスタート待ち＋接続失敗になる（「不安定」の大きな原因）。
// Render上（RENDER_EXTERNAL_URLが自動注入される）でのみ、10分ごとに自分自身へ
// HTTPリクエストを送って眠らせない。ローカル開発では何もしない。
// 注意: 無料枠の月間稼働時間(750h)を常時消費する（1インスタンスなら31日分でほぼ丁度）。
function startKeepAlive() {
  const selfUrl = process.env.RENDER_EXTERNAL_URL
  if (!selfUrl) return
  const ping = () => {
    try {
      const mod = selfUrl.startsWith('https') ? require('https') : require('http')
      mod.get(`${selfUrl}/api/storage-status`, (res: http.IncomingMessage): void => { res.resume() })
        .on('error', (): void => undefined)
    } catch {}
  }
  setInterval(ping, 10 * 60 * 1000)
  console.log(`[KeepAlive] スピンダウン防止のため10分ごとに自身へアクセスします: ${selfUrl}`)
}

// 保存済みデータ（会議室の内容・チャット・看板など）をメモリへ読み込んでから待ち受ける。
// 読み込み前にルームが作られると、空の状態で上書き保存されてしまうため必ず先に完了させる。
hydrate()
  .then(() => {
    gameServer.listen(port)
    console.log(`Listening on ws://localhost:${port}`)
    // 切断判定の設定が実際に効いているかを起動ログで確認できるようにする
    // （transportインスタンスが持つ実値を読む。定数の写しではない）
    const t = gameServer.transport as any
    console.log(`[WS] ping設定: interval=${t.pingIntervalMS}ms retries=${t.pingMaxRetries} （無応答 約${(t.pingIntervalMS * t.pingMaxRetries) / 1000}秒で切断）`)
    // 保存済みデータを読み込んだ後に始める（参照の判定に全ドキュメントが要るため）
    startFileCleanup()
    // 起動直後の状態を残す。デプロイで壊した場合でも、この時点に戻せる
    startBackups()
    startKeepAlive()
  })
  .catch((e) => {
    // 読み込めないまま起動すると、空の状態を保存済みデータへ上書きしてしまう。
    // データを守るためここでは起動せず終了する（Renderは自動で再起動する）。
    console.error('[Storage] 保存データの読み込みに失敗したため起動を中止しました:', e)
    process.exit(1)
  })

// GEMINI_API_KEY が設定されている場合はbotを自動起動
if (process.env.GEMINI_API_KEY) {
  let botProcess: ChildProcess | null = null

  const startBots = () => {
    console.log('[Bots] AUTOMATA agents starting...')
    botProcess = spawn(
      process.execPath,
      ['-r', 'ts-node/register', 'bots/bot-runner.ts', `ws://localhost:${port}`],
      {
        env: {
          ...process.env,
          TS_NODE_PROJECT: path.join(__dirname, 'tsconfig.server.json'),
          TS_NODE_TRANSPILE_ONLY: 'true',
        },
        cwd: __dirname,
        stdio: 'inherit',
      }
    )
    botProcess.on('error', (err) => console.error('[Bots] spawn error:', err))
    botProcess.on('exit', (code, signal) => {
      console.log(`[Bots] exited: code=${code} signal=${signal}`)
      if (signal !== 'SIGTERM' && signal !== 'SIGINT') {
        console.log('[Bots] Restarting in 30s...')
        setTimeout(startBots, 30000)
      }
    })
  }

  // Colyseusが準備できるまで5秒待ってからbot起動
  setTimeout(startBots, 5000)

  process.on('SIGTERM', () => { botProcess?.kill('SIGTERM') })
  process.on('SIGINT', () => { botProcess?.kill('SIGTERM') })
} else {
  console.log('[Bots] GEMINI_API_KEY not set — bot auto-start skipped')
}
