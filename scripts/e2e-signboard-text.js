/**
 * テキストだけの看板が設置できるか検証する。
 * 画像なし(image='')の経路が壊れていないかを見る。
 */
const { chromium } = require('playwright')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
let failed = 0
const check = (c, ok, ng) => { log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }

;(async () => {
  const browser = await chromium.launch({ args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'] })
  const page = await (await browser.newContext({ permissions:['camera','microphone'], viewport:{width:1400,height:900} })).newPage()
  const errs = []
  page.on('pageerror', e => { errs.push('pageerror: ' + e.message); log('[pageerror]', e.message.slice(0,200)) })
  page.on('console', m => { if (m.type()==='error') { errs.push('console: '+m.text()); log('[console.error]', m.text().slice(0,200)) } })

  await page.goto('http://localhost:5173')
  await page.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await page.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
  await page.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await page.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 30000 })
  await page.locator('input[type="text"]').first().fill('Aさん')
  await page.getByRole('button', { name: '入室する' }).click()
  await page.waitForSelector('text=チャット', { timeout: 20000 })
  await wait(2500)

  const before = await page.evaluate(() => window.game.scene.keys.game.signboardMap.size)
  log(`看板の数(設置前): ${before}`)

  log('\n== UIから「看板を設置」→ テキスト入力 → 確定 ==')
  // ラベルではなくアイコンのボタンを押す（onClickはボタン側にある）
  await page.evaluate(() => {
    const label = [...document.querySelectorAll('*')]
      .filter((e) => e.children.length === 0 && e.textContent.trim() === '看板を設置')[0]
    const btn = label.parentElement.querySelector('button')
    btn.click()
  })
  await wait(1200)
  await page.screenshot({ path: '_e2e_out/sb-text-1-dialog.png' })
  const dialogOpen = await page.evaluate(() => window.__store.getState().signboard.signboardDialogOpen)
  log(`   ダイアログが開いた: ${dialogOpen}`)
  check(dialogOpen === true, '看板ダイアログが開く', '看板ダイアログが開かない')

  // テキストを入力
  const ta = page.locator('textarea, input[type="text"]').first()
  await ta.click()
  await ta.type('テストの看板です', { delay: 30 })
  await wait(500)
  await page.screenshot({ path: '_e2e_out/sb-text-2-typed.png' })

  // 確定ボタン
  const btns = await page.evaluate(() => [...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(Boolean))
  log(`   ダイアログのボタン: ${JSON.stringify(btns)}`)
  const placeBtn = page.getByRole('button', { name: /設置|決定|OK|確定/ }).first()
  const n = await placeBtn.count()
  check(n > 0, '確定ボタンがある', `確定ボタンが無い: ${JSON.stringify(btns)}`)
  if (n > 0) {
    const disabled = await placeBtn.isDisabled()
    log(`   確定ボタンが押せるか: ${!disabled}`)
    check(!disabled, '確定ボタンが押せる（テキストだけでも設置できる）', '確定ボタンが無効のまま＝設置できない')
    if (!disabled) await placeBtn.click()
  }
  await wait(1200)

  // マップをクリックして設置
  const placing = await page.evaluate(() => window.game.scene.keys.game.isPlacingSignboard)
  log(`   設置モードに入った: ${placing}`)
  check(placing === true, 'マップ上の設置モードに入る', '設置モードに入らない')
  await page.mouse.click(500, 400)
  await wait(2500)

  const after = await page.evaluate(() => window.game.scene.keys.game.signboardMap.size)
  log(`看板の数(設置後): ${after}`)
  check(after > before, `テキスト看板が設置された (${before}→${after})`, `設置されていない (${before}→${after})`)
  await page.screenshot({ path: '_e2e_out/sb-text-3-placed.png' })

  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  await browser.close()
  process.exit(failed === 0 ? 0 : 1)
})().catch(e => { console.error('FATAL', e); process.exit(1) })
