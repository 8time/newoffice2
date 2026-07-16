/**
 * 固定ミーティングルーム(473,440)とログイン時の自動接続を検証する。
 *  - ログイン画面で「CONNECT WEBCAM」を押さなくてもカメラ/マイクに自動接続されるか
 *  - 既定でカメラOFF・マイクONになっているか
 *  - 会議室1の入口が全ユーザーの画面にあるか
 *  - 解除した(749,464)付近＝旧会議室2に入口が残っていないか
 *  - 別々のユーザーが同じ入口から入ると同じ部屋で合流できるか
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
  return page
}

// プレイヤーを指定のワールド座標へ直接移動させ、入口ゾーンとの重なりを発生させる
async function walkTo(page, x, y) {
  await page.evaluate(({ x, y }) => {
    const g = window.game.scene.keys.game
    g.myPlayer.setPosition(x, y)
    g.myPlayer.playerContainer.setPosition(x, y - 30)
  }, { x, y })
  await wait(1200) // 物理のoverlap判定が走るのを待つ
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  })

  // ─── テスト1: ログイン画面で自動接続されるか ───
  log('== テスト1: ログイン時の自動接続（カメラOFF・マイクON） ==')
  const A = await open(browser, 'A')
  await wait(3000) // 自動getMediaの完了を待つ

  const beforeJoin = await A.evaluate(() => {
    const warn = [...document.querySelectorAll('button')].some((b) => /CONNECT WEBCAM/i.test(b.textContent))
    const video = document.querySelector('video')
    return { manualButtonShown: warn, hasPreview: !!(video && video.srcObject) }
  })
  log(`   「CONNECT WEBCAM」ボタンが出ている: ${beforeJoin.manualButtonShown}`)
  log(beforeJoin.hasPreview && !beforeJoin.manualButtonShown
    ? '[PASS] 押さなくても自動でカメラ/マイクに接続された'
    : '[FAIL] 自動接続されていない（手動ボタンが出たまま）')
  await A.screenshot({ path: path.join(OUT_DIR, 'mr-01-login.png') })

  await A.locator('input[type="text"]').first().fill('Aさん')
  await A.getByRole('button', { name: '入室する' }).click()
  await A.waitForSelector('text=チャット', { timeout: 20000 })
  await wait(2500)

  const media = await A.evaluate(() => {
    const rtc = window.game.scene.keys.game.network.webRTC
    return {
      hasStream: !!rtc.myStream,
      isVideoOff: rtc.isVideoOff,
      isAudioMuted: rtc.isAudioMuted,
      videoTrackEnabled: rtc.myStream?.getVideoTracks()[0]?.enabled,
      audioTrackEnabled: rtc.myStream?.getAudioTracks()[0]?.enabled,
    }
  })
  log(`   接続後: ${JSON.stringify(media)}`)
  log(media.hasStream && media.isVideoOff && media.videoTrackEnabled === false
    ? '[PASS] カメラはOFFで開始（映像は送信されない）'
    : '[FAIL] カメラがONのまま')
  log(media.audioTrackEnabled === true && !media.isAudioMuted
    ? '[PASS] マイクはONで開始'
    : '[FAIL] マイクがミュートで開始している')

  // ─── テスト2: 固定会議室の入口が存在するか ───
  log('\n== テスト2: 固定ミーティングルームの入口 ==')
  const rooms = await A.evaluate(() => {
    const g = window.game.scene.keys.game
    return g.meetingRoomEntrances.getChildren()
      .map((z) => z.getData('meetingRoom'))
      .filter(Boolean)
      .map((r) => ({ id: r.id, name: r.name, x: r.x, y: r.y }))
  })
  log('   入口一覧: ' + JSON.stringify(rooms))
  const r1 = rooms.find((r) => r.id === 'meeting-room-1')
  log(r1 && r1.x === 473 && r1.y === 440 ? '[PASS] 会議室1が (473, 440) にある' : '[FAIL] 会議室1が無い/座標が違う')
  // (749,464)を覆っていた会議室2は解除済み。ゾーンが残っていないことを確かめる
  const covering = rooms.filter((r) => {
    const w = r.width ?? 96, h = r.height ?? 96
    return Math.abs(r.x - 749) <= w / 2 && Math.abs(r.y - 464) <= h / 2
  })
  log(covering.length === 0
    ? '[PASS] (749,464)付近に会議室の入口が無い（解除できている）'
    : `[FAIL] (749,464)付近にまだ入口がある: ${JSON.stringify(covering)}`)

  // ─── テスト3: 別ユーザーが同じ入口から入ると同じ部屋になるか ───
  log('\n== テスト3: 2人が同じ会議室で合流できるか ==')
  const B = await open(browser, 'B')
  await wait(2500)
  await B.locator('input[type="text"]').first().fill('Bさん')
  await B.getByRole('button', { name: '入室する' }).click()
  await B.waitForSelector('text=チャット', { timeout: 20000 })
  await wait(2000)

  await walkTo(A, 473, 440)
  await walkTo(B, 473, 440)
  await wait(1500)

  const inRoom = async (p) => p.evaluate(() => window.__store.getState().meetingRoom.activeRoom?.id ?? null)
  const aRoom = await inRoom(A)
  const bRoom = await inRoom(B)
  log(`   A=${aRoom}  B=${bRoom}`)
  log(aRoom === 'meeting-room-1' && bRoom === 'meeting-room-1'
    ? '[PASS] 2人とも会議室1に入室し、同じ部屋で合流している'
    : '[FAIL] 同じ部屋に入れていない')
  await A.screenshot({ path: path.join(OUT_DIR, 'mr-02-A-in-room1.png') })

  // 解除した(749,464)へ歩いても、もう会議室に入らないこと
  await A.evaluate(() => {
    window.__store.dispatch({ type: 'meetingRoom/clearActiveMeetingRoom' })
    window.__phaserEvents.emit('meeting-room-exit')
  })
  await wait(1800)
  await walkTo(A, 749, 464)
  await wait(1500)
  const aRoom2 = await inRoom(A)
  log(`   Aを(749,464)へ: ${aRoom2}`)
  log(aRoom2 === null ? '[PASS] (749,464)へ歩いても会議室に入らない' : `[FAIL] まだ会議室に入ってしまう: ${aRoom2}`)

  log(`\nスクリーンショット: ${OUT_DIR}`)
  await browser.close()
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
