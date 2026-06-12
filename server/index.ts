import http from 'http'
import express from 'express'
import cors from 'cors'
import { Server, LobbyRoom } from 'colyseus'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { monitor } from '@colyseus/monitor'
import { RoomType } from '../types/Rooms'
import { spawn, ChildProcess } from 'child_process'

// import socialRoutes from "@colyseus/social/express"

import { SkyOffice, getAttendanceForDate } from './rooms/SkyOffice'

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

gameServer.listen(port)
console.log(`Listening on ws://localhost:${port}`)

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
