/**
 * 固定ルーム（合言葉/URL）の検証。
 *  - 合言葉を入れて入室でき、URLに ?room= が付くか
 *  - 別ブラウザで同じ合言葉を入れると同じ部屋に合流できるか
 *  - そのURLを直接開くと（合言葉入力なしで）自動入室するか
 *  - 全員退出して部屋が消えても、同じURLで入り直せるか
 */
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

const OUT_DIR = path.join(__dirname, '..', '_e2e_out')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)
const KEY = 'e2e-team-' + Date.now().toString(36)

async function newPage(browser) {
  const page = await (await browser.newContext({
    permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'],
    viewport: { width: 1400, height: 900 },
  })).newPage()
  return page
}

async function waitReady(page) {
  await page.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await page.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
}

async function login(page, name) {
  await page.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 30000 })
  await page.locator('input[type="text"]').first().fill(name)
  await page.getByRole('button', { name: '入室する' }).click()
  await page.waitForSelector('text=チャット', { timeout: 20000 })
}

const currentColyseusRoomId = (page) =>
  page.evaluate(() => window.game.scene.keys.game.network?.room?.id ?? null)

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })

  // ─── テスト1: 合言葉で入室し、URLに ?room= が付く ───
  log(`== テスト1: 合言葉「${KEY}」で入室 ==`)
  const A = await newPage(browser)
  await A.goto('http://localhost:5173')
  await waitReady(A)
  await A.locator('input[placeholder="例: eigyou-team"]').fill(KEY)
  await A.getByRole('button', { name: '入る' }).click()
  await login(A, 'Aさん')

  const urlA = A.url()
  log(`   AのURL: ${urlA}`)
  log(urlA.includes(`room=${encodeURIComponent(KEY)}`) ? '[PASS] URLに合言葉が付いた' : '[FAIL] URLに付いていない')
  const roomIdA = await currentColyseusRoomId(A)
  log(`   Aのルーム内部ID: ${roomIdA}`)

  // ─── テスト2: 別ブラウザで同じ合言葉 → 同じ部屋に合流 ───
  log('\n== テスト2: 別ユーザーが同じ合言葉で合流 ==')
  const B = await newPage(browser)
  await B.goto('http://localhost:5173')
  await waitReady(B)
  await B.locator('input[placeholder="例: eigyou-team"]').fill(KEY)
  await B.getByRole('button', { name: '入る' }).click()
  await login(B, 'Bさん')
  const roomIdB = await currentColyseusRoomId(B)
  log(`   Bのルーム内部ID: ${roomIdB}`)
  log(roomIdA && roomIdA === roomIdB ? '[PASS] AとBが同じ部屋に合流した' : '[FAIL] 別々の部屋になっている')

  // 参加者一覧でお互いが見えるか（同室の確証）
  await wait(1500)
  const bSeesA = await B.evaluate(() => {
    const names = [...window.__store.getState().user.playerNameMap.values()]
    return names.includes('Aさん')
  })
  log(bSeesA ? '[PASS] Bの在室者にAが見える' : '[FAIL] Bから見てAがいない')

  // ─── テスト3: URLを直接開くと合言葉入力なしで自動入室 ───
  log('\n== テスト3: URL直リンクで自動入室 ==')
  const C = await newPage(browser)
  await C.goto(urlA) // Aと同じ ?room= 付きURL
  await waitReady(C)
  // 合言葉入力もボタンも押さずに roomJoined になるはず
  const autoJoined = await C.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 20000 })
    .then(() => true).catch(() => false)
  log(autoJoined ? '[PASS] URLを開いただけで自動入室した（合言葉入力不要）' : '[FAIL] 自動入室しない')
  if (autoJoined) {
    await login(C, 'Cさん')
    const roomIdC = await currentColyseusRoomId(C)
    log(roomIdC === roomIdA ? '[PASS] 直リンクでも同じ部屋に入れた' : '[FAIL] 別の部屋に入った')
  }
  await C.screenshot({ path: path.join(OUT_DIR, 'fixed-01-C-autojoin.png') })

  // ─── テスト4: 全員退出 → 部屋が消えても、同じURLで入り直せる ───
  log('\n== テスト4: 全員退出後にURLで再入室 ==')
  await A.close(); await B.close(); await C.close()
  await wait(4000) // autoDisposeで部屋が破棄されるのを待つ

  const D = await newPage(browser)
  await D.goto(urlA)
  await waitReady(D)
  const rejoined = await D.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 20000 })
    .then(() => true).catch(() => false)
  log(rejoined ? '[PASS] 空室で消えた後もURLで作り直して入室できた' : '[FAIL] 再入室できない')

  log(`\nスクリーンショット: ${OUT_DIR}`)
  await browser.close()
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
