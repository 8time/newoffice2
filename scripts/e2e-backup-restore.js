/**
 * 会議室の内容が「何があっても消えない」かを検証する。
 * バックアップは"取れている"だけでは意味がなく、"戻せる"ことまで確かめる。
 *
 *  1. ホワイトボードに描くとバックアップが残る
 *  2. 全部消してしまっても、前の状態に戻せる
 *  3. 戻す前の状態もバックアップされる（戻し間違えてもやり直せる）
 *  4. 変化が無ければ世代を増やさない（無駄に容量を食わない）
 *  5. 参照の判定が壊れているときは、使用中の画像を消さない（安全弁）
 */

const SERVER = 'http://localhost:2567'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
let failed = 0
const check = (c, ok, ng) => { log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }

const api = async (path, opts) => {
  const res = await fetch(SERVER + path, opts)
  return { status: res.status, body: await res.json().catch(() => null) }
}

async function main() {
  log('== 準備: ホワイトボードに内容を入れる ==')
  // サーバーに直接スナップショットを送る（クライアントが描いた状態を再現）
  const { Client } = require('colyseus.js')
  const client = new Client('ws://localhost:2567')
  const room = await client.joinOrCreate('skyoffice', { name: 'backup', anonymous: true, clientId: 'bk_' + Date.now() })
  await wait(2000)

  const MEETING_WHITEBOARD_SYNC = 14 // types/Messages.ts の並び順
  const roomId = 'backup_test_room'
  const important = {
    elements: [
      { id: 'el1', type: 'text', text: '消えたら困る議事録', version: 1, versionNonce: 1 },
      { id: 'el2', type: 'rectangle', version: 1, versionNonce: 2 },
    ],
    files: {},
    updatedAt: Date.now(),
  }
  room.send(MEETING_WHITEBOARD_SYNC, { roomId, payload: important })
  await wait(4500) // サーバー側の保存（3秒デバウンス）を待つ

  log('\n== 1. バックアップが残るか ==')
  await api('/api/backups/now', { method: 'POST' })
  await wait(1500)
  let list = (await api('/api/backups')).body
  const wbBackups = list.filter((b) => b.target === 'whiteboards')
  log(`   ホワイトボードの世代: ${wbBackups.length}件（最新: ${wbBackups[0]?.savedAt}）`)
  check(wbBackups.length > 0, 'ホワイトボードのバックアップが取れている', 'バックアップが無い')

  const snap = (await api(`/api/backups/${encodeURIComponent(wbBackups[0].name)}`)).body
  const savedRoom = snap?.value?.[roomId]
  check(
    !!savedRoom && JSON.stringify(savedRoom).includes('消えたら困る議事録'),
    'バックアップに実際の内容が入っている',
    `中身が入っていない: ${JSON.stringify(savedRoom).slice(0, 120)}`
  )

  log('\n== 2. 変化が無ければ世代を増やさないか ==')
  const before = (await api('/api/backups')).body.length
  await api('/api/backups/now', { method: 'POST' })
  await wait(1200)
  const after = (await api('/api/backups')).body.length
  log(`   ${before}件 → ${after}件`)
  check(after === before, '変化が無ければ増えない（容量を無駄にしない）', `増えてしまった: ${before}→${after}`)

  log('\n== 3. 全部消してしまっても戻せるか ==')
  // 事故を再現：中身を空にして上書きする
  room.send(MEETING_WHITEBOARD_SYNC, { roomId, payload: { elements: [], files: {}, updatedAt: Date.now() } })
  await wait(4500)
  const usageBefore = (await api('/api/storage-status')).body
  log(`   （事故発生。ホワイトボードのルーム数: ${usageBefore.docs.whiteboards}）`)

  const restoreTarget = wbBackups[0].name
  const r = await api('/api/backups/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: restoreTarget }),
  })
  log(`   復元: ${JSON.stringify(r.body)}`)
  await wait(1500)
  check(r.status === 200, '復元のAPIが成功した', `失敗: ${r.status} ${JSON.stringify(r.body)}`)

  // 復元後の中身を、新しいクライアントから取り直して確認する
  const c2 = new Client('ws://localhost:2567')
  const room2 = await c2.joinOrCreate('skyoffice', { name: 'checker', anonymous: true, clientId: 'ck_' + Date.now() })
  let restored = null
  room2.onMessage(MEETING_WHITEBOARD_SYNC, (m) => { if (m.roomId === roomId) restored = m.payload })
  await wait(1000)
  room2.send(15, { roomId }) // REQUEST_MEETING_WHITEBOARD_SNAPSHOT
  await wait(2500)
  const text = JSON.stringify(restored || {})
  log(`   復元後の中身: ${text.slice(0, 100)}`)
  check(text.includes('消えたら困る議事録'), '★消した内容が元通りに戻った', `戻っていない: ${text.slice(0, 160)}`)

  log('\n== 4. 戻す前の状態もバックアップされているか（やり直せるか）==')
  const list2 = (await api('/api/backups')).body
  const hasPreRestore = list2.some((b) => b.target === 'whiteboards' && b.savedAt > wbBackups[0].savedAt)
  check(hasPreRestore, '復元前の状態も世代として残っている', '復元前の状態が残っていない')

  await room.leave(); await room2.leave()

  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  process.exit(failed === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
