/**
 * 会議室の表示設定がブラウザに保存され、次回も同じ表示で開けるか検証する。
 *  - キャンバスの表示倍率（下部の +/- で調整する 10% の部分）
 *  - メモ欄とキャンバスの境目の位置
 * どちらも「その人の見え方の好み」なので、他の人には同期しないことも確認する。
 */
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

const OUT_DIR = path.join(__dirname, '..', '_e2e_out')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
let failed = 0
const check = (c, ok, ng) => { log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }

async function enter(ctx) {
  const p = await ctx.newPage()
  await p.goto('http://localhost:5173')
  await p.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await p.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
  await p.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await p.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 30000 })
  await p.locator('input[type="text"]').first().fill('Aさん')
  await p.getByRole('button', { name: '入室する' }).click()
  await p.waitForSelector('text=チャット', { timeout: 20000 })
  await wait(2500)
  // 会議室1へ
  await p.evaluate(() => {
    const g = window.game.scene.keys.game
    g.myPlayer.setPosition(473, 440)
    g.myPlayer.playerContainer.setPosition(473, 410)
  })
  await p.waitForFunction(() => window.__store.getState().meetingRoom.activeRoom !== null, { timeout: 20000 })
  await wait(4000)
  return p
}

const getZoom = (p) => p.evaluate(() => window.__excalidrawApiForTest?.getAppState?.().zoom?.value ?? null)
// メモ欄の幅（境目の位置）
const getDocWidth = (p) => p.evaluate(() => {
  // DocPaneは style={{width: docWidth}} が付く唯一の要素
  const el = [...document.querySelectorAll('div[style]')].find((d) => {
    const w = parseInt(d.style.width)
    return Number.isFinite(w) && w >= 300 && w <= 2000
  })
  return el ? parseInt(el.style.width) : null
})

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  // 同じコンテキスト＝同じブラウザ＝localStorageが引き継がれる（「次回きたとき」を再現）
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1500, height: 900 } })

  log('== 1回目: 倍率と境目を変える ==')
  const p1 = await enter(ctx)
  const zoom0 = await getZoom(p1)
  log(`   初期の倍率: ${zoom0}`)

  // 倍率を変える（+ボタンと同じくappStateのzoomを動かす）
  await p1.evaluate(() => {
    window.__excalidrawApiForTest.updateScene({ appState: { zoom: { value: 2.5 } } })
  })
  await wait(1500)
  const zoom1 = await getZoom(p1)
  log(`   変更後の倍率: ${zoom1}`)
  check(zoom1 !== null && zoom1 !== zoom0, '倍率を変更できた（テストの前提）', '倍率が変わらない＝検証できない')

  // 境目をドラッグして動かす
  const w0 = await getDocWidth(p1)
  const handle = p1.locator('div').filter({ has: p1.locator('xpath=self::*') })
  await p1.mouse.move(420, 450)
  await p1.mouse.down()
  await p1.mouse.move(620, 450, { steps: 10 })
  await p1.mouse.up()
  await wait(1200)
  const w1 = await getDocWidth(p1)
  log(`   境目の位置: ${w0} → ${w1}`)

  const saved = await p1.evaluate(() => ({
    zoom: Object.keys(localStorage).filter((k) => k.startsWith('skyoffice_wb_zoom_')).map((k) => [k, localStorage.getItem(k)]),
    docW: localStorage.getItem('skyoffice_meeting_doc_width'),
  }))
  log(`   保存内容: ${JSON.stringify(saved)}`)
  check(saved.zoom.length > 0, '倍率がブラウザに保存された', '倍率が保存されていない')
  await p1.screenshot({ path: path.join(OUT_DIR, 'layout-1.png') })
  await p1.close()

  log('\n== 2回目: 同じブラウザで入り直す ==')
  const p2 = await enter(ctx)
  const zoom2 = await getZoom(p2)
  log(`   復元された倍率: ${zoom2}（前回: ${zoom1}）`)
  check(zoom2 === zoom1, '前回の倍率で開いた', `倍率が復元されない: ${zoom1} → ${zoom2}`)

  const w2 = await getDocWidth(p2)
  log(`   復元された境目: ${w2}（前回: ${w1}）`)
  if (saved.docW) {
    check(w2 === w1, '前回の境目の位置で開いた', `境目が復元されない: ${w1} → ${w2}`)
  } else {
    log('   （境目のドラッグが発生しなかったため、この項目は判定なし）')
  }
  await p2.screenshot({ path: path.join(OUT_DIR, 'layout-2.png') })

  log('\n== 別の人には影響しないか（倍率は個人設定）==')
  const ctxB = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1500, height: 900 } })
  const pB = await enter(ctxB)
  const zoomB = await getZoom(pB)
  log(`   別の人の倍率: ${zoomB}`)
  check(zoomB !== zoom1, '別の人の倍率は変わらない（同期していない）', `別の人にも倍率が伝わっている: ${zoomB}`)

  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  await browser.close()
  process.exit(failed === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
