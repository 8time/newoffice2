/**
 * 「同じ会議室に入ったのに相手が非表示」対策の検証。
 * 2人が同じ固定会議室(473,440)に入り、双方の会議室カメラ列に
 * 相手の映像タイル(.peer-video-wrapper)が現れるかを確認する。
 * 会議室に入っている間はVideoOverlayは描画されないため、
 * ドキュメント上の .peer-video-wrapper は会議室のカメラ列に入ったものだけ。
 */
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

const OUT_DIR = path.join(__dirname, '..', '_e2e_out')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

async function open(browser) {
  const page = await (await browser.newContext({
    permissions: ['camera', 'microphone'],
    viewport: { width: 1400, height: 900 },
  })).newPage()
  await page.goto('http://localhost:5173')
  await page.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await page.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
  await page.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await page.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 30000 })
  return page
}

async function login(page, name) {
  await page.locator('input[type="text"]').first().fill(name)
  await page.getByRole('button', { name: '入室する' }).click()
  await page.waitForSelector('text=チャット', { timeout: 20000 })
  await wait(2500)
}

async function walkTo(page, x, y) {
  await page.evaluate(({ x, y }) => {
    const g = window.game.scene.keys.game
    g.myPlayer.setPosition(x, y)
    g.myPlayer.playerContainer.setPosition(x, y - 30)
  }, { x, y })
  await wait(1200)
}

const inRoom = (p) => p.evaluate(() => window.__store.getState().meetingRoom.activeRoom?.id ?? null)
const peerTiles = (p) => p.evaluate(() => document.querySelectorAll('.peer-video-wrapper').length)

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  })

  const A = await open(browser)
  await login(A, 'Aさん')
  const B = await open(browser)
  await login(B, 'Bさん')

  log('== 2人が同じ会議室(473,440)に入る ==')
  await walkTo(A, 473, 440)
  await walkTo(B, 473, 440)

  // WebRTC接続とDOMマウントが走るのを待つ（数回のリトライ込み）
  let ok = false
  for (let i = 0; i < 12; i++) {
    await wait(1000)
    const [aRoom, bRoom, aTiles, bTiles] = await Promise.all([
      inRoom(A), inRoom(B), peerTiles(A), peerTiles(B),
    ])
    log(`   t+${i + 1}s A=${aRoom}/tiles=${aTiles}  B=${bRoom}/tiles=${bTiles}`)
    if (aRoom === 'meeting-room-1' && bRoom === 'meeting-room-1' && aTiles >= 1 && bTiles >= 1) {
      ok = true
      break
    }
  }

  await A.screenshot({ path: path.join(OUT_DIR, 'pv-A.png') })
  await B.screenshot({ path: path.join(OUT_DIR, 'pv-B.png') })
  log(ok
    ? '[PASS] 双方の会議室カメラ列に相手の映像タイルが表示された'
    : '[FAIL] 相手の映像タイルが表示されなかった')

  await browser.close()
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
