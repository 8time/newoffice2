/**
 * 看板の画像テクスチャが二重読み込みでエラーにならないか検証する。
 * 実機で出ていた症状:
 *   Texture key already in use: signtex_...
 *   Uncaught TypeError: Cannot read properties of null (reading 'source')
 * addBase64は非同期のため、同じ看板が2回追加されると二重にaddBase64され、
 * 2回目のonloadでaddImageがnullを返して未捕捉の例外になっていた。
 * あわせて勤怠APIが :2567 決め打ちでないことも確認する。
 */
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

const OUT_DIR = path.join(__dirname, '..', '_e2e_out')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)
let failed = 0
const check = (c, ok, ng) => { log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }

// 1x1の赤いPNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  const page = await (await browser.newContext({
    permissions: ['camera', 'microphone'], viewport: { width: 1400, height: 900 },
  })).newPage()

  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

  await page.goto('http://localhost:5173')
  await page.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await page.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
  await page.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await page.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 30000 })
  await page.locator('input[type="text"]').first().fill('Aさん')
  await page.getByRole('button', { name: '入室する' }).click()
  await page.waitForSelector('text=チャット', { timeout: 20000 })
  await wait(2500)

  log('== 1. 同じ看板を二重に追加してもエラーにならないか ==')
  // サーバーのonAddと入室時のreplayが重なる状況を、同じイベントを2回流して再現する
  const id = 'sign_test_' + Date.now()
  await page.evaluate(({ id, img }) => {
    const ev = window.__phaserEvents
    const data = { id, x: 400, y: 300, text: '', image: img, url: '', createdBy: 'me', bgColor: '#ffffff', textColor: '#000000', scale: 1 }
    ev.emit('signboard-added', data)
    ev.emit('signboard-added', data)  // 読み込み完了前にもう一度（レースの再現）
  }, { id, img: PNG })
  await wait(3000)

  const texErrors = errors.filter((e) => /already in use|reading 'source'/.test(e))
  texErrors.forEach((e) => log('   ' + e.slice(0, 120)))
  check(texErrors.length === 0, '二重追加してもテクスチャのエラーが出ない', `テクスチャのエラーが出た(${texErrors.length}件)`)

  const shown = await page.evaluate((id) => {
    const g = window.game.scene.keys.game
    return { rendered: !!g.signboardMap?.get(id), texture: g.textures.exists('signtex_' + id) }
  }, id)
  log('   ' + JSON.stringify(shown))
  check(shown.rendered && shown.texture, '看板が1つだけ正しく表示された', '看板が表示されていない')

  log('\n== 2. 勤怠APIが :2567 決め打ちになっていないか ==')
  const attendanceReqs = []
  page.on('request', (r) => { if (/api\/attendance/.test(r.url())) attendanceReqs.push(r.url()) })
  await page.getByRole('button', { name: '更新' }).first().click().catch(() => {})
  await wait(2500)
  log('   リクエスト先: ' + JSON.stringify(attendanceReqs))
  const failedAttendance = errors.filter((e) => /attendance/.test(e))
  check(failedAttendance.length === 0, '勤怠APIの取得に失敗していない', `勤怠APIが失敗: ${failedAttendance[0]}`)

  await page.screenshot({ path: path.join(OUT_DIR, 'signboard-texture.png') })
  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  await browser.close()
  process.exit(failed === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
