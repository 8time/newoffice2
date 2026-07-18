/**
 * アイドル切断対策の検証。
 *  - 入室後、クライアントが25秒ごとにHEARTBEATメッセージ（実データ）を送っている
 *  - 送信フレームがWebSocket上に実際に流れている（中継のアイドル切断を防ぐ）
 *  - 切断時にcloseコードがコンソールに残る（原因切り分け用）
 *
 * HEARTBEATのenum番号を types/Messages.ts から動的に読む（末尾に追加したため）。
 */
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
let failed = 0
const check = (c, ok, ng) => { log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }

// Messages.ts の enum から HEARTBEAT の数値を求める（先頭からの序数）
function heartbeatOpcode() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'types', 'Messages.ts'), 'utf8')
  const body = src.slice(src.indexOf('{') + 1, src.indexOf('}'))
  const names = body.split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'))
    .map((l) => l.replace(/,.*/, '').replace(/=.*/, '').trim())
    .filter((n) => /^[A-Z_]+$/.test(n))
  return names.indexOf('HEARTBEAT')
}

async function main() {
  const HB = heartbeatOpcode()
  log(`HEARTBEATのopcode = ${HB}`)
  check(HB >= 0, 'HEARTBEATがMessages定義にある', 'HEARTBEATが見つからない')

  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1300, height: 850 } })
  const p = await ctx.newPage()

  // 送信WebSocketフレームを監視。Colyseusのメッセージは [opcode, ...] のバイナリ。
  // 先頭バイトがHEARTBEATのopcodeのフレームを数える。
  // Colyseusの room.send(type) は [Protocol.ROOM_DATA(13), <encoded type>] の
  // バイナリで送られる。HEARTBEAT(52)は0-127なのでmsgpackで1バイト＝52。
  // よって心拍フレームは先頭2バイトが [13, 52]。
  const ROOM_DATA = 13
  let heartbeatFramesSent = 0
  let totalBinaryFramesSent = 0
  const closeLogs = []
  p.on('console', (m) => { if (/切断されました code=/.test(m.text())) closeLogs.push(m.text()) })
  p.on('websocket', (ws) => {
    ws.on('framesent', (f) => {
      const payload = f.payload
      if (payload && typeof payload !== 'string' && payload.length >= 2) {
        totalBinaryFramesSent++
        if (payload[0] === ROOM_DATA && payload[1] === HB) heartbeatFramesSent++
      }
    })
  })

  await p.goto('http://localhost:5173')
  await p.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await p.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
  await p.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await p.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 30000 })
  await p.locator('input[type="text"]').first().fill('心拍テスト')
  await p.getByRole('button', { name: '入室する' }).click()
  await p.waitForSelector('text=チャット', { timeout: 20000 })

  log('入室完了。心拍(25秒間隔)を最大55秒待って2回以上流れるか確認する…')
  const start = Date.now()
  while (heartbeatFramesSent < 2 && Date.now() - start < 56000) {
    await wait(2000)
  }
  log(`   送信されたHEARTBEATフレーム数: ${heartbeatFramesSent} (全バイナリ送信フレーム: ${totalBinaryFramesSent})`)
  check(heartbeatFramesSent >= 2, '心拍(HEARTBEAT)が25秒ごとに実データとして送られている', `心拍が流れていない（${heartbeatFramesSent}回, 全${totalBinaryFramesSent}フレーム）`)

  // 切断コードのログ確認: ページを閉じて（＝離脱）、別ページで onLeave ログの仕組みが
  // 動くことを見る…のは難しいので、ここではサーバー再起動なしに
  // room.leave() を呼んで onLeave→ログが出ることを確認する。
  log('切断コードのログを確認するため room.leave() を呼ぶ…')
  await p.evaluate(() => window.game.scene.keys.game.network.room?.leave())
  await wait(1500)
  log('   切断ログ: ' + JSON.stringify(closeLogs))
  check(closeLogs.some((l) => /code=/.test(l)), '切断時にcloseコードがログに残る', '切断コードのログが出ていない')

  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  await browser.close()
  process.exit(failed === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
