/**
 * WebGLが使えずCanvas描画に降格したとき、その旨を知らせる警告が出るか検証する。
 * 実機で「マップは出るのに動けない」となり、Consoleに
 * 「Canvas2D: Multiple readback operations using getImageData...」が
 * 大量に出ていた状況＝Canvas降格を、WebGLを無効化して再現する。
 */
const { chromium } = require('playwright')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
let failed = 0
const check = (c, ok, ng) => { log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }

async function boot(browser, disableWebGL) {
  const ctx = await browser.newContext({ permissions: ['camera','microphone'], viewport:{width:1400,height:900} })
  const page = await ctx.newPage()
  if (disableWebGL) {
    // WebGLコンテキストを取得できない状況を作る（Phaser.AUTOはCanvasへ降格する）
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        if (/webgl/i.test(String(type))) return null
        return orig.call(this, type, ...rest)
      }
    })
  }
  await page.goto('http://localhost:5173')
  await page.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
  await wait(2000)
  return page
}

;(async () => {
  const browser = await chromium.launch()

  log('== 1. WebGLが使えるとき（通常）==')
  const ok = await boot(browser, false)
  const t1 = await ok.evaluate(() => window.game.renderer.type)
  log(`   renderer.type = ${t1} (2=WEBGL)`)
  const warn1 = await ok.locator('text=描画が低速モード').count()
  check(t1 === 2, 'WebGLで動作している', `WebGLでない: ${t1}`)
  check(warn1 === 0, '通常時に余計な警告は出ない', '通常時に警告が出てしまう')

  log('\n== 2. WebGLが使えないとき（Canvas降格＝実機で固まっていた状況）==')
  const ng = await boot(browser, true)
  const t2 = await ng.evaluate(() => window.game.renderer.type)
  log(`   renderer.type = ${t2} (1=CANVAS)`)
  check(t2 === 1, 'Canvas描画に降格した（症状を再現できた）', `降格していない: ${t2}`)
  await ng.waitForSelector('text=描画が低速モード', { timeout: 10000 }).catch(() => {})
  const warn2 = await ng.locator('text=描画が低速モード').count()
  check(warn2 > 0, '低速モードの警告が表示された（原因が利用者に分かる）', '警告が出ない＝黙って重いまま')
  const hasReload = await ng.getByRole('button', { name: '再読み込み' }).count()
  check(hasReload > 0, '再読み込みボタンが出ている', '再読み込みボタンが無い')
  await ng.screenshot({ path: '_e2e_out/renderer-warning.png' })

  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  await browser.close()
  process.exit(failed === 0 ? 0 : 1)
})().catch(e => { console.error('FATAL', e); process.exit(1) })
