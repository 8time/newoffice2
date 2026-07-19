/**
 * PeerJS(通話の署名サーバー)から切断されたとき、同じIDで自動的に繋ぎ直すか検証する。
 * 実ブローカー(0.peerjs.com)の往復は環境依存で不安定なので、reconnect()をスタブして
 * 「disconnectedイベント → reconnect()が呼ばれる」配線を決定的に確認する。
 * あわせて、PeerJSの切断が切断履歴(localStorage)に記録されることも見る。
 */
const { chromium } = require('playwright')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
let failed = 0
const check = (c, ok, ng) => { log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }
const KEY = 'skyoffice_disconnect_log'

async function main() {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1200, height: 800 } })
  const p = await ctx.newPage()
  await p.goto('http://localhost:5173')
  await p.evaluate((k) => localStorage.removeItem(k), KEY)
  await p.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await p.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
  await p.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await p.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 30000 })
  await p.locator('input[type="text"]').first().fill('通話再接続テスト')
  await p.getByRole('button', { name: '入室する' }).click()
  await p.waitForSelector('text=チャット', { timeout: 20000 })
  await wait(2500)

  const hasPeer = await p.evaluate(() => !!window.game?.scene?.keys?.game?.network?.webRTC?.myPeer)
  check(hasPeer, 'PeerJS(myPeer)が生成されている', 'myPeerが無い')

  log('== 署名サーバー切断(disconnected)を起こす → 自動でreconnect()が呼ばれるか ==')
  await p.evaluate(() => {
    const peer = window.game.scene.keys.game.network.webRTC.myPeer
    window.__reconnectCalls = 0
    // 実ブローカーへ繋ぎに行かないようスタブ（配線だけを見る）
    peer.reconnect = () => { window.__reconnectCalls++ }
    // PeerJSは署名サーバーのソケットが閉じると disconnected を発火する。それを模す。
    peer.emit('disconnected')
  })
  // ハンドラは1000ms後にreconnectを呼ぶ設計。余裕を見て待つ
  await wait(1600)
  const calls = await p.evaluate(() => window.__reconnectCalls)
  log('   reconnect()呼び出し回数: ' + calls)
  check(calls >= 1, '署名サーバー切断で自動的にreconnect()が呼ばれた', `呼ばれていない: ${calls}`)

  log('== PeerJSの切断が切断履歴(localStorage)に記録されるか ==')
  const stored = await p.evaluate((k) => localStorage.getItem(k), KEY)
  log('   履歴: ' + stored)
  const arr = JSON.parse(stored || '[]')
  const peerEntry = arr.find((e) => e.code === -1)
  check(!!peerEntry, 'PeerJS切断(code=-1)が履歴に残る', `残っていない: ${stored}`)
  check(peerEntry && /PeerJS/.test(peerEntry.reason), '説明にPeerJSと分かる文言が入る', `説明が不十分: ${JSON.stringify(peerEntry)}`)

  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  await browser.close()
  process.exit(failed === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
