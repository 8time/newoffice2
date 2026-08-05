/**
 * 頭上スタンプの表示時間を約4秒に延ばした確認。
 * 以前は2.2秒で消え始めていた。延長後は約3秒経ってもはっきり表示されていることを見る
 * （ヘッドレスではtweenのゲーム内時間が実時間より遅く進むため、消滅時刻は実時間で測らない）。
 */
const { chromium } = require('playwright')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
let failed = 0
const check = (c, ok, ng) => { log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }

async function main() {
  const b = await chromium.launch({ args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--disable-gpu'] })
  const p = await (await b.newContext({ permissions:['camera','microphone'], viewport:{width:1300,height:850} })).newPage()
  await p.goto('http://localhost:5173', { timeout: 40000 })
  await p.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await p.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
  await p.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await p.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 20000 })
  await wait(2000)
  await p.locator('input[type="text"]').first().fill('スタンプ時間')
  await p.getByRole('button', { name: '入室する' }).click()
  await p.waitForSelector('text=チャット', { timeout: 20000 })
  await wait(1500)

  // 頭上の絵文字テキスト(depth20000, 見えている)を数える
  const visible = () => p.evaluate(() => window.game.scene.keys.game.children.list
    .filter((o) => o.type === 'Text' && o.depth === 20000 && o.alpha > 0.3).length)

  await p.evaluate(() => {
    const g = window.game.scene.keys.game
    g.handleEmote(g.network.mySessionId, '😀')
  })
  await wait(300)
  check(await visible() >= 1, 'スタンプ（絵文字）が頭上に出た', '出ていない')

  await wait(3000) // 約3.3秒経過
  const v = await visible()
  log('   約3.3秒後の表示数: ' + v)
  check(v >= 1, '約3.3秒後もはっきり表示（以前は2.2秒で消え始めていた）＝延長が効いている', '3秒台で消えている')

  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  await b.close()
  process.exit(failed === 0 ? 0 : 1)
}
main().catch(e=>{console.error('FATAL', e.message); process.exit(1)})
