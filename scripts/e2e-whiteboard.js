/**
 * ミーティングルームのホワイトボードを2ブラウザで実際に操作して検証するE2Eドライバ。
 *
 * 前提: サーバー(:2567)とViteのdevサーバー(:5173)が起動していること。
 * 実行:  node scripts/e2e-whiteboard.js
 * 出力:  スクリーンショットと [PASS]/[FAIL] のログ、ブラウザのconsoleエラー
 */
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

const CLIENT = 'http://localhost:5173'
const OUT_DIR = path.join(__dirname, '..', '_e2e_out')

const MEETING_ROOM = {
  id: 'e2e_room',
  name: 'E2E会議室',
  x: 100, y: 100, width: 100, height: 100, returnX: 700, returnY: 500,
}

function log(...a) { console.log(...a) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function openClient(browser, playerName) {
  const context = await browser.newContext({
    permissions: ['camera', 'microphone'],
    viewport: { width: 1400, height: 900 },
  })
  const page = await context.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

  await page.goto(CLIENT)
  // 「パブリックロビーに接続」は、ロビー未接続だと無視され、
  // Phaserのアセット読み込み(preloadComplete)が終わっていないとlaunchGame()が黙って
  // 早期returnするため、どちらも完了するまで待ってからクリックする
  await page.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await page.waitForFunction(() => {
    const bs = window.game?.scene?.keys?.bootstrap
    return !!bs && bs.preloadComplete === true
  }, { timeout: 30000 })
  await page.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await page.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 30000 })
  // MUIのTextFieldはlabelとinputのfor紐付けが効かないことがあるため、name入力欄を直接指定する
  await page.locator('input[type="text"]').first().fill(playerName, { timeout: 20000 })
  await page.getByRole('button', { name: '入室する' }).click()
  // ゲーム画面（サイドバー）が出るまで待つ
  await page.waitForSelector('text=チャット', { timeout: 20000 })
  return { page, context, errors }
}

// マップ上を歩かずに会議室オーバーレイを開く（Reduxへ直接dispatch）
async function enterMeetingRoom(page) {
  await page.evaluate((room) => {
    const store = window.__store
    store.dispatch({ type: 'meetingRoom/setActiveMeetingRoom', payload: room })
    // サーバーにも在室を伝える（配信先の絞り込みに必要）
    const game = window.game?.scene?.keys?.game
    game?.network?.updateMeetingRoomId(room.id)
  }, MEETING_ROOM)
  await page.waitForSelector('.excalidraw', { timeout: 20000 })
  await wait(1500) // Excalidrawの初期化とスナップショット受信を待つ
}

// Excalidrawのキャンバス上でドラッグして矩形を描く
async function drawRectangle(page, x1, y1, x2, y2) {
  await page.keyboard.press('r') // rectangleツール
  const canvas = page.locator('.excalidraw canvas').first()
  const box = await canvas.boundingBox()
  await page.mouse.move(box.x + x1, box.y + y1)
  await page.mouse.down()
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 12 })
  await page.mouse.up()
  await page.keyboard.press('Escape')
}

async function getElements(page) {
  return page.evaluate(() => {
    const api = window.__excalidrawApiForTest
    if (!api) return null
    return api.getSceneElementsIncludingDeleted().map((e) => ({
      id: e.id, type: e.type, x: Math.round(e.x), y: Math.round(e.y),
      version: e.version, isDeleted: e.isDeleted, fileId: e.fileId,
    }))
  })
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  })

  log('== 2クライアントでログイン ==')
  const A = await openClient(browser, 'Aさん')
  const B = await openClient(browser, 'Bさん')

  log('== 両者を同じ会議室へ ==')
  await enterMeetingRoom(A.page)
  await enterMeetingRoom(B.page)
  await A.page.screenshot({ path: path.join(OUT_DIR, '01-A-meeting.png') })

  // ─── テスト1: Aが図形を描く → Bに現れるか ───
  log('\n== テスト1: 図形の同期 ==')
  await drawRectangle(A.page, 300, 200, 420, 300)
  await wait(2500)

  const bEls = await getElements(B.page)
  const aEls = await getElements(A.page)
  if (bEls === null) {
    log('[SKIP] テスト用APIフックが無いため要素を直接読めない。スクリーンショットで確認')
  } else {
    const rect = bEls.filter((e) => e.type === 'rectangle' && !e.isDeleted)
    log(rect.length > 0
      ? `[PASS] Aの矩形がBに届いた (${rect.length}個)`
      : `[FAIL] Bに矩形が無い。A側=${JSON.stringify(aEls)}`)
  }
  await B.page.screenshot({ path: path.join(OUT_DIR, '02-B-after-A-draw.png') })

  // ─── テスト2: 図形をドラッグして動かす → 巻き戻らないか ───
  log('\n== テスト2: ドラッグして動かす（巻き戻り確認） ==')
  const canvasA = A.page.locator('.excalidraw canvas').first()
  const boxA = await canvasA.boundingBox()
  await A.page.keyboard.press('v') // selection
  await A.page.mouse.move(boxA.x + 360, boxA.y + 250)
  await A.page.mouse.down()
  await A.page.mouse.move(boxA.x + 620, boxA.y + 430, { steps: 20 })
  await A.page.mouse.up()
  await A.page.keyboard.press('Escape')

  const posRightAfter = await getElements(A.page)
  await wait(3000) // エコーが戻ってくるならこの間に巻き戻る
  const posLater = await getElements(A.page)

  if (posRightAfter && posLater) {
    const r1 = posRightAfter.find((e) => e.type === 'rectangle' && !e.isDeleted)
    const r2 = posLater.find((e) => e.type === 'rectangle' && !e.isDeleted)
    if (r1 && r2) {
      log(r1.x === r2.x && r1.y === r2.y
        ? `[PASS] 3秒後も位置が保たれている (x=${r2.x}, y=${r2.y}) — 巻き戻りなし`
        : `[FAIL] 巻き戻った: 直後(${r1.x},${r1.y}) → 3秒後(${r2.x},${r2.y})`)
    }
  }
  await A.page.screenshot({ path: path.join(OUT_DIR, '03-A-after-drag.png') })
  await B.page.screenshot({ path: path.join(OUT_DIR, '04-B-after-drag.png') })

  // ─── テスト3: 画像の挿入と表示までの時間 ───
  log('\n== テスト3: 画像の挿入 ==')
  // 200KBのPNGを作ってAのExcalidrawへ貼り付ける
  const pngPath = path.join(OUT_DIR, 'test-image.png')
  if (!fs.existsSync(pngPath)) {
    // 有効な小さいPNGを生成（Playwright側でcanvasから作る）
    const dataUrl = await A.page.evaluate(() => {
      const c = document.createElement('canvas')
      c.width = 600; c.height = 400
      const g = c.getContext('2d')
      const grd = g.createLinearGradient(0, 0, 600, 400)
      grd.addColorStop(0, '#ff0000'); grd.addColorStop(1, '#0000ff')
      g.fillStyle = grd; g.fillRect(0, 0, 600, 400)
      g.fillStyle = '#fff'; g.font = '48px sans-serif'
      g.fillText('E2E IMAGE', 150, 220)
      return c.toDataURL('image/png')
    })
    fs.writeFileSync(pngPath, Buffer.from(dataUrl.split(',')[1], 'base64'))
  }
  log(`   画像サイズ: ${(fs.statSync(pngPath).size / 1024).toFixed(0)}KB`)

  const tStart = Date.now()
  // Excalidrawの画像ツールはOSのファイルダイアログを開くためPlaywrightから操作できない。
  // 実ユーザーの「画像をペーストする」操作と同じく、clipboard paste イベントを直接投げる。
  const pngBase64 = fs.readFileSync(pngPath).toString('base64')
  await A.page.evaluate(async (b64) => {
    const bin = atob(b64)
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    const file = new File([arr], 'e2e.png', { type: 'image/png' })
    const dt = new DataTransfer()
    dt.items.add(file)
    const canvas = document.querySelector('.excalidraw canvas')
    canvas.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, pngBase64)

  // A側に画像要素が現れるまで待つ
  let aImgs = []
  for (let i = 0; i < 40; i++) {
    aImgs = (await getElements(A.page))?.filter((e) => e.type === 'image' && !e.isDeleted) || []
    if (aImgs.length > 0) break
    await wait(250)
  }
  log(`   A側の画像要素: ${aImgs.length}個 (${Date.now() - tStart}ms)`)
  await A.page.screenshot({ path: path.join(OUT_DIR, '05-A-image.png') })

  // Bに画像要素が届き、さらに画像の実体（ファイル）がロードされて実際に描画されるまでを測る
  let elArrivedAt = null
  let fileArrivedAt = null
  for (let i = 0; i < 80; i++) {
    const st = await B.page.evaluate(() => {
      const api = window.__excalidrawApiForTest
      if (!api) return null
      const imgs = api.getSceneElementsIncludingDeleted().filter((e) => e.type === 'image' && !e.isDeleted)
      const files = api.getFiles() || {}
      return { imgs: imgs.length, filesLoaded: imgs.filter((e) => files[e.fileId]).length }
    })
    if (st && st.imgs > 0 && !elArrivedAt) elArrivedAt = Date.now()
    if (st && st.filesLoaded > 0) { fileArrivedAt = Date.now(); break }
    await wait(200)
  }

  if (aImgs.length === 0) {
    log('[FAIL] A側に画像を挿入できなかった')
  } else {
    log(`   A側の画像要素: ${aImgs.length}個（挿入 ${Date.now() - tStart}ms）`)
    log(elArrivedAt ? `[PASS] Bに画像要素が届いた（${elArrivedAt - tStart}ms）` : '[FAIL] Bに画像要素が届かない')
    log(fileArrivedAt ? `[PASS] Bで画像の実体が読み込まれ描画された（${fileArrivedAt - tStart}ms）` : '[FAIL] Bで画像が表示されない（実体が届いていない）')
  }
  await wait(1500)
  await B.page.screenshot({ path: path.join(OUT_DIR, '06-B-image.png') })

  // ─── consoleエラー ───
  log('\n== ブラウザのconsoleエラー ==')
  const allErrors = [...new Set([...A.errors, ...B.errors])]
    .filter((e) => !/favicon|Download the React DevTools|WebGL|AudioContext/i.test(e))
  if (allErrors.length === 0) log('   なし')
  else allErrors.slice(0, 15).forEach((e) => log('   ! ' + e.slice(0, 300)))

  log(`\nスクリーンショット: ${OUT_DIR}`)
  await browser.close()
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
