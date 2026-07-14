/**
 * 看板の操作を検証する。
 *  - 画像だけの看板に背景・枠（フチ）が付かないこと
 *  - 設置した看板をドラッグで自由に動かせること（相手にも同期されること）
 *  - ホイールで拡大縮小できること（相手にも同期されること）
 */
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

const OUT_DIR = path.join(__dirname, '..', '_e2e_out')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

async function open(browser, name) {
  const page = await (await browser.newContext({
    permissions: ['camera', 'microphone'],
    viewport: { width: 1400, height: 900 },
  })).newPage()
  await page.goto('http://localhost:5173')
  await page.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await page.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
  await page.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await page.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 30000 })
  await wait(2500)
  await page.locator('input[type="text"]').first().fill(name)
  await page.getByRole('button', { name: '入室する' }).click()
  await page.waitForSelector('text=チャット', { timeout: 20000 })
  return page
}

// 看板の状態（位置・スケール・背景の有無）を読む
async function readSign(page) {
  return page.evaluate(() => {
    const g = window.game.scene.keys.game
    const [id, c] = [...g.signboardMap.entries()][0] || []
    if (!c) return null
    return {
      id,
      x: Math.round(c.x),
      y: Math.round(c.y),
      scale: Number(c.scaleX.toFixed(3)),
      // 背景/枠はGraphicsとして子に入る。画像だけの看板なら存在しないはず
      hasBackground: c.list.some((o) => o.type === 'Graphics'),
      children: c.list.map((o) => o.type),
    }
  })
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  })
  const A = await open(browser, 'Aさん')
  const B = await open(browser, 'Bさん')
  await wait(1500)

  // 既存の看板を消してから、画像だけの看板を1枚置く
  await A.evaluate(async () => {
    const net = window.game.scene.keys.game.network
    const g = window.game.scene.keys.game
    for (const id of [...g.signboardMap.keys()]) net.removeSignboard(id)

    // 100x60 の画像を作る
    const c = document.createElement('canvas')
    c.width = 100; c.height = 60
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#e91e63'; ctx.fillRect(0, 0, 100, 60)
    ctx.fillStyle = '#fff'; ctx.font = '16px sans-serif'; ctx.fillText('IMG', 30, 36)

    net.addSignboard({ x: 700, y: 600, text: '', image: c.toDataURL('image/png'), url: '' })
  })
  await wait(2500)

  // ─── テスト1: 画像だけの看板にフチが付かないか ───
  log('== テスト1: 画像だけの看板のフチ ==')
  const s1 = await A.evaluate(() => {
    const g = window.game.scene.keys.game
    const c = [...g.signboardMap.values()][0]
    if (!c) return null
    return { hasBackground: c.list.some((o) => o.type === 'Graphics'), children: c.list.map((o) => o.type) }
  })
  log(`   看板の中身: ${JSON.stringify(s1)}`)
  log(s1 && !s1.hasBackground && s1.children.includes('Image')
    ? '[PASS] 画像だけの看板に背景・枠が付いていない'
    : '[FAIL] まだフチ（背景/枠）が付いている')
  await A.screenshot({ path: path.join(OUT_DIR, 'sign-01-image-noborder.png') })

  // ─── テスト2: ドラッグで動かせるか ───
  log('\n== テスト2: ドラッグで移動 ==')
  const before = await readSign(A)
  const canvasBox = await A.locator('canvas').first().boundingBox()
  // 看板のワールド座標を画面座標に変換してドラッグする
  const pt = await A.evaluate(({ wx, wy }) => {
    const cam = window.game.scene.keys.game.cameras.main
    return { x: (wx - cam.worldView.x) * cam.zoom, y: (wy - cam.worldView.y) * cam.zoom }
  }, { wx: before.x + 20, wy: before.y + 10 })

  await A.mouse.move(canvasBox.x + pt.x, canvasBox.y + pt.y)
  await A.mouse.down()
  await A.mouse.move(canvasBox.x + pt.x + 90, canvasBox.y + pt.y - 60, { steps: 15 })
  await A.mouse.up()
  await wait(2000)

  const afterA = await readSign(A)
  const afterB = await readSign(B)
  log(`   A: (${before.x},${before.y}) → (${afterA.x},${afterA.y})`)
  log(`   B: (${afterB.x},${afterB.y})`)
  const movedA = afterA.x !== before.x || afterA.y !== before.y
  log(movedA ? '[PASS] ドラッグで看板を動かせた' : '[FAIL] 動かせない')
  log(movedA && Math.abs(afterB.x - afterA.x) <= 2 && Math.abs(afterB.y - afterA.y) <= 2
    ? '[PASS] 移動が相手にも同期されている'
    : '[FAIL] 相手に同期されていない')

  // ─── テスト3: ホイールで拡大縮小できるか ───
  log('\n== テスト3: ホイールで拡大縮小 ==')
  const pt2 = await A.evaluate(({ wx, wy }) => {
    const cam = window.game.scene.keys.game.cameras.main
    return { x: (wx - cam.worldView.x) * cam.zoom, y: (wy - cam.worldView.y) * cam.zoom }
  }, { wx: afterA.x + 20, wy: afterA.y + 10 })

  await A.mouse.move(canvasBox.x + pt2.x, canvasBox.y + pt2.y)
  await A.mouse.wheel(0, -400) // 上にスクロール = 拡大
  await wait(2000)

  const scaledA = await readSign(A)
  const scaledB = await readSign(B)
  log(`   A: スケール ${afterA.scale} → ${scaledA.scale}`)
  log(`   B: スケール ${scaledB.scale}`)
  log(scaledA.scale > afterA.scale ? '[PASS] ホイールで拡大できた' : '[FAIL] 拡大縮小できない')
  log(Math.abs(scaledB.scale - scaledA.scale) < 0.01
    ? '[PASS] 拡大縮小が相手にも同期されている'
    : '[FAIL] 相手に同期されていない')

  await A.screenshot({ path: path.join(OUT_DIR, 'sign-02-moved-scaled.png') })
  log(`\nスクリーンショット: ${OUT_DIR}`)
  await browser.close()
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
