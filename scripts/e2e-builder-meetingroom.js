/**
 * マップビルダーで置いた会議室の検証。
 *  - 入口を2か所置いても、どちらから入っても同じ部屋（同じID）になる
 *  - 別々の入口から入った2人が合流できる（＝ホワイトボードを共有できる）
 *  - 置き直しても部屋IDが変わらない（＝中身が迷子にならない）
 */
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

const OUT_DIR = path.join(__dirname, '..', '_e2e_out')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)
let failed = 0
const check = (c, ok, ng) => { log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }

async function open(browser) {
  const page = await (await browser.newContext({
    permissions: ['camera', 'microphone'], viewport: { width: 1400, height: 900 },
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
  await wait(1500)
}
const inRoom = (p) => p.evaluate(() => window.__store.getState().meetingRoom.activeRoom?.id ?? null)
const exitRoom = async (p) => {
  await p.evaluate(() => {
    window.__store.dispatch({ type: 'meetingRoom/clearActiveMeetingRoom' })
    window.__phaserEvents.emit('meeting-room-exit')
  })
  await wait(1800)
}
// マップビルダーで会議室を設置する
const place = (p, x, y) => p.evaluate(({ x, y }) => {
  window.game.scene.keys.game.network.addBuilderItem({
    id: 'mr_' + Math.random().toString(36).slice(2, 8),
    itemType: 'meetingroom', x, y, frame: 0, direction: 'down',
  })
}, { x, y })

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  const A = await open(browser); await login(A, 'Aさん')
  const B = await open(browser); await login(B, 'Bさん')

  // 既存の設置物を片付けてから、入口を2か所置く
  await A.evaluate(() => window.game.scene.keys.game.network.clearBuilderItems())
  await wait(1500)
  const E1 = { x: 300, y: 300 }
  const E2 = { x: 900, y: 700 }
  await place(A, E1.x, E1.y)
  await place(A, E2.x, E2.y)
  await wait(2500)

  log('== 1. 入口を2か所設置。どちらから入っても同じ部屋か ==')
  await walkTo(A, E1.x, E1.y)
  const aRoom = await inRoom(A)
  log(`   Aが入口1から入室: ${aRoom}`)
  await walkTo(B, E2.x, E2.y)
  const bRoom = await inRoom(B)
  log(`   Bが入口2から入室: ${bRoom}`)
  check(!!aRoom && aRoom === bRoom, `別々の入口から入っても同じ部屋になった (${aRoom})`, `別々の部屋になった A=${aRoom} B=${bRoom}`)
  check(aRoom === 'builder-meeting-room', '部屋IDが設置物に依存しない固定IDになっている', `固定IDでない: ${aRoom}`)

  log('\n== 2. 別々の入口から入った2人が合流できるか ==')
  const members = await A.evaluate(() => {
    const st = window.__store.getState()
    const id = st.meetingRoom.activeRoom?.id
    return [...st.user.playerMeetingRoomMap.entries()].filter(([, r]) => r === id).length
  })
  log(`   同室の他メンバー数(自分以外): ${members}`)
  check(members >= 1, '別の入口から入った相手と同じ部屋で合流できた', '相手が同室として認識されていない')
  await A.screenshot({ path: path.join(OUT_DIR, 'builder-mr.png') })

  log('\n== 3. 置き直しても部屋IDが変わらないか ==')
  await exitRoom(A); await exitRoom(B)
  await A.evaluate(() => window.game.scene.keys.game.network.clearBuilderItems())
  await wait(1500)
  await place(A, 500, 500)   // 別の場所に置き直す
  await wait(2500)
  await walkTo(A, 500, 500)
  const aRoom2 = await inRoom(A)
  log(`   置き直した入口から入室: ${aRoom2}`)
  check(aRoom2 === aRoom, '置き直しても同じ部屋IDのまま（中身を引き継げる）', `IDが変わった: ${aRoom} → ${aRoom2}`)

  // 設置物はルーム共通の状態として保存されるため、必ず片付けてから終わる。
  // 残すと他のE2E（会議室の入口の判定など）を汚染する。
  await exitRoom(A)
  await A.evaluate(() => window.game.scene.keys.game.network.clearBuilderItems())
  await wait(2500)
  const left = await A.evaluate(() => window.__store.getState().mapBuilder.placedItems.length)
  log(`\n後始末: 残った設置物 ${left}件`)

  log(failed === 0 ? '=== 全項目 PASS ===' : `=== ${failed}件 FAIL ===`)
  await browser.close()
  process.exit(failed === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
