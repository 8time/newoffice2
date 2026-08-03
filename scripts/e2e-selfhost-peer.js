/**
 * 自己ホストのPeerServer(localhost:9000)に、PeerJSクライアントが実際に接続できるか検証する。
 * アプリにバンドル済みのPeerクラスを流用し、自己ホスト向けオプション(host/port/secure/path)で
 * 新しいPeerを作って 'open'（署名サーバーに接続成功）するのを確認する。
 * これが通れば、本番でVITE_PEER_HOST等を設定したときに自己ホストへ繋がる裏付けになる。
 */
const { chromium } = require('playwright')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
let failed = 0
const check = (c, ok, ng) => { log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }

async function main() {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1200, height: 800 } })
  const p = await ctx.newPage()
  await p.goto('http://localhost:5173')
  await p.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await p.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
  await p.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await p.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 30000 })
  await p.locator('input[type="text"]').first().fill('自己ホスト検証')
  await p.getByRole('button', { name: '入室する' }).click()
  await p.waitForSelector('text=チャット', { timeout: 20000 })
  await wait(2000)

  const hasPeerClass = await p.evaluate(() => !!window.game?.scene?.keys?.game?.network?.webRTC?.myPeer?.constructor)
  check(hasPeerClass, 'バンドル済みのPeerクラスが取得できる', 'Peerクラスが無い')

  log('== 自己ホストPeerServer(localhost:9000)へ接続を試みる ==')
  const result = await p.evaluate(async () => {
    const P = window.game.scene.keys.game.network.webRTC.myPeer.constructor
    const testId = 'selfhost_test_' + Math.random().toString(36).slice(2, 8)
    return await new Promise((resolve) => {
      let done = false
      // 本番で buildPeerOptions が作るのと同じ形（secure:false=ローカルはws）
      const peer = new P(testId, { host: 'localhost', port: 9000, path: '/', secure: false })
      const finish = (r) => { if (!done) { done = true; try { peer.destroy() } catch {} resolve(r) } }
      peer.on('open', (id) => finish({ ok: true, id }))
      peer.on('error', (e) => finish({ ok: false, type: e.type, msg: String(e && e.message || e) }))
      setTimeout(() => finish({ ok: false, type: 'timeout' }), 12000)
    })
  })
  log('   結果: ' + JSON.stringify(result))
  check(result.ok === true, '自己ホストPeerServerに接続できた（openした）', `接続できない: ${JSON.stringify(result)}`)
  check(result.ok && typeof result.id === 'string', '自分のPeer IDが払い出された', 'IDが無い')

  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  await browser.close()
  process.exit(failed === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
