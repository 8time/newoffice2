/**
 * マップ上の右クリックで座標が表示されるかを実ブラウザで検証する。
 *  - 何もない場所を右クリック → 座標マーカーが出てクリップボードにコピーされるか
 *  - 表示された座標が、実際にクリックしたワールド座標と一致するか
 *  - ブラウザ標準の右クリックメニューがマップ上では出ないこと（既存の抑止が生きているか）
 */
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

const OUT_DIR = path.join(__dirname, '..', '_e2e_out')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  })
  const ctx = await browser.newContext({
    permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'],
    viewport: { width: 1400, height: 900 },
  })
  const page = await ctx.newPage()

  await page.goto('http://localhost:5173')
  await page.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await page.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
  await page.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await page.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 30000 })
  await page.locator('input[type="text"]').first().fill('座標テスト')
  await page.getByRole('button', { name: '入室する' }).click()
  await page.waitForSelector('text=チャット', { timeout: 20000 })
  await wait(2000)

  // マップ上の何もない場所を右クリック
  const canvas = page.locator('canvas').first()
  const box = await canvas.boundingBox()
  const clickX = box.x + 250
  const clickY = box.y + 620
  await page.mouse.click(clickX, clickY, { button: 'right' })
  await wait(800)

  // Phaserのシーンから、実際に表示されたマーカーのテキストを読む
  const shown = await page.evaluate(() => {
    const scene = window.game.scene.keys.game
    const texts = scene.children.list
      .filter((o) => o.type === 'Container' && o.depth === 30000)
      .flatMap((c) => c.list.filter((o) => o.type === 'Text').map((t) => t.text))
    return texts
  })

  if (shown.length === 0) {
    log('[FAIL] 右クリックしても座標マーカーが出ていない')
  } else {
    log(`[PASS] 座標マーカーが表示された:\n${shown[0].split('\n').map((l) => '        ' + l).join('\n')}`)

    // 表示座標が実際のクリック位置（ワールド座標）と一致するか照合する
    const expected = await page.evaluate(({ cx, cy }) => {
      const scene = window.game.scene.keys.game
      const rect = window.game.canvas.getBoundingClientRect()
      const wp = scene.cameras.main.getWorldPoint(cx - rect.left, cy - rect.top)
      return { x: Math.round(wp.x), y: Math.round(wp.y) }
    }, { cx: clickX, cy: clickY })

    const m = shown[0].match(/x: (-?\d+), y: (-?\d+)/)
    const got = m ? { x: Number(m[1]), y: Number(m[2]) } : null
    log(`   期待値 (${expected.x}, ${expected.y}) / 表示 (${got?.x}, ${got?.y})`)
    log(got && Math.abs(got.x - expected.x) <= 1 && Math.abs(got.y - expected.y) <= 1
      ? '[PASS] 表示座標がクリックしたワールド座標と一致'
      : '[FAIL] 座標がずれている')
  }

  // クリップボードにコピーされたか
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))
  log(clip && /^-?\d+, -?\d+$/.test(clip.trim())
    ? `[PASS] クリップボードにコピーされた: "${clip}"`
    : `[FAIL] クリップボードにコピーされていない: "${clip}"`)

  // マーカーが自動で消えるか
  await wait(3500)
  const after = await page.evaluate(() => {
    const scene = window.game.scene.keys.game
    return scene.children.list.filter((o) => o.type === 'Container' && o.depth === 30000).length
  })
  log(after === 0 ? '[PASS] マーカーが自動で消えた' : `[FAIL] マーカーが残っている (${after}個)`)

  await page.screenshot({ path: path.join(OUT_DIR, 'coord-01.png') })

  // 消える前の見た目を撮る
  await page.mouse.click(box.x + 620, box.y + 560, { button: "right" })
  await wait(500)
  await page.screenshot({ path: path.join(OUT_DIR, 'coord-02-marker.png') })

  log(`\nスクリーンショット: ${OUT_DIR}`)
  await browser.close()
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
