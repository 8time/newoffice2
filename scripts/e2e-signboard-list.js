/**
 * 設定ダイアログの「設置した画像・看板」一覧から、位置に関係なく看板を削除できるか検証する。
 * 画面端でクリックできない画像でも消せることの担保。
 */
const { chromium } = require('playwright')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
let failed = 0
const check = (c, ok, ng) => { log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }

async function main() {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--disable-gpu','--no-sandbox'] })
  const p = await (await browser.newContext({ permissions:['camera','microphone'], viewport:{width:1400,height:900} })).newPage()
  await p.goto('http://localhost:5173', { timeout: 40000 })
  await p.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await p.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
  await p.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await p.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 20000 })
  await wait(2000)
  await p.locator('input[type="text"]').first().fill('一覧削除')
  await p.getByRole('button', { name: '入室する' }).click()
  await p.waitForSelector('text=チャット', { timeout: 20000 })
  await wait(1500)

  // 画面端(サイドバー裏を想定)に画像看板を2枚置く
  await p.evaluate(async () => {
    const g = window.game.scene.keys.game
    for (const id of [...g.signboardMap.keys()]) g.network.removeSignboard(id)
    const mk = (col) => { const c=document.createElement('canvas'); c.width=80;c.height=50; const x=c.getContext('2d'); x.fillStyle=col; x.fillRect(0,0,80,50); return c.toDataURL('image/png') }
    g.network.addSignboard({ x: 2000, y: 100, text:'', image: mk('#e74c3c'), url:'' }) // 画面外想定
    g.network.addSignboard({ x: 720, y: 600, text:'', image: mk('#2ecc71'), url:'' })
  })
  await wait(2500)
  check(await p.evaluate(() => window.game.scene.keys.game.signboardMap.size) === 2, '画像看板を2枚設置できた', '設置できていない')

  log('== 設定を開いて一覧に出るか ==')
  await p.evaluate(() => window.__store.dispatch({ type: 'settings/openSettingsDialog' }))
  await p.waitForSelector('text=設置した画像・看板', { timeout: 8000 }).catch(()=>{})
  const listCount = await p.getByText(/設置した画像・看板/).isVisible().catch(()=>false)
  check(listCount, '「設置した画像・看板」セクションが出る', 'セクションが出ない')
  const delButtons = await p.getByRole('button', { name: '削除' }).count()
  log('   一覧の削除ボタン数: ' + delButtons)
  check(delButtons === 2, '2枚とも一覧に出て削除ボタンがある', `削除ボタンが${delButtons}個`)

  log('== 一覧から1枚削除 ==')
  await p.getByRole('button', { name: '削除' }).first().click()
  await wait(1500)
  const after = await p.evaluate(() => window.game.scene.keys.game.signboardMap.size)
  log('   削除後の看板数: ' + after)
  check(after === 1, '一覧から看板を削除できた', `削除されていない(${after})`)
  const delButtons2 = await p.getByRole('button', { name: '削除' }).count()
  check(delButtons2 === 1, '一覧も1件に更新される', `一覧が${delButtons2}件`)

  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  await browser.close()
  process.exit(failed === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
