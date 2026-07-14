/**
 * 会議室の画面共有を2ブラウザで検証する。
 * ヘッドレスChromiumではgetDisplayMedia()が使えないため、canvasのcaptureStream()で
 * 「画面共有ストリーム」を偽装して差し替える（replaceTrackの経路は本物と同じ）。
 *
 * 確認すること:
 *   - A→B、B→A のどちらの向きでも共有映像が届くか（onCalledPeersの取りこぼしがないか）
 *   - 共有者のカメラがOFFでも、受信側でアバターに隠されず映像が表示されるか
 */
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

const OUT_DIR = path.join(__dirname, '..', '_e2e_out')
const ROOM = { id: 'e2e_ss', name: 'E2E', x: 1, y: 1, width: 1, height: 1, returnX: 1, returnY: 1 }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

async function open(browser, name) {
  const ctx = await browser.newContext({
    permissions: ['camera', 'microphone'],
    viewport: { width: 1400, height: 900 },
  })
  const page = await ctx.newPage()
  // getDisplayMediaをcanvas captureStreamで偽装（ヘッドレスでは本物が使えない）
  await page.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const c = document.createElement('canvas')
      c.width = 640; c.height = 360
      const g = c.getContext('2d')
      let t = 0
      setInterval(() => {
        g.fillStyle = '#101820'; g.fillRect(0, 0, 640, 360)
        g.fillStyle = '#ffd700'; g.font = 'bold 44px sans-serif'
        g.fillText('SHARED SCREEN', 120, 190)
        g.fillRect(20 + (t % 560), 300, 40, 20)
        t += 8
      }, 100)
      return c.captureStream(15)
    }
  })
  await page.goto('http://localhost:5173')
  await page.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await page.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
  await page.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await page.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 30000 })
  await page.locator('input[type="text"]').first().fill(name)
  await page.getByRole('button', { name: '入室する' }).click()
  await page.waitForSelector('text=チャット', { timeout: 20000 })
  return page
}

async function enterRoom(page) {
  await page.evaluate((room) => {
    window.__store.dispatch({ type: 'meetingRoom/setActiveMeetingRoom', payload: room })
    window.game.scene.keys.game.network.updateMeetingRoomId(room.id)
  }, ROOM)
  await page.waitForSelector('.excalidraw', { timeout: 20000 })
}

// 2者をWebRTCで接続させる（通常はマップ上の近接で発火するので、直接callさせる）
async function connectPeers(pageA, sessionIdB) {
  await pageA.evaluate((sid) => {
    window.game.scene.keys.game.network.webRTC.connectToNewUser(sid)
  }, sessionIdB)
}

async function sessionId(page) {
  return page.evaluate(() => window.__store.getState().user.sessionId)
}

// 受信側で「相手の映像要素が実際に表示されているか」を調べる
async function peerVideoState(page) {
  return page.evaluate(() => {
    const wrappers = [...document.querySelectorAll('.peer-video-wrapper')]
    return wrappers.map((w) => {
      const v = w.querySelector('video')
      const avatar = w.querySelector('.peer-avatar-fallback')
      const cs = v ? getComputedStyle(v) : null
      return {
        sessionId: w.dataset.sessionId,
        videoDisplay: cs ? cs.display : 'none',
        videoW: v ? v.videoWidth : 0,
        videoH: v ? v.videoHeight : 0,
        avatarVisible: avatar ? getComputedStyle(avatar).display !== 'none' : false,
        objectFit: cs ? cs.objectFit : '',
      }
    })
  })
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  })

  const A = await open(browser, 'Aさん')
  const B = await open(browser, 'Bさん')
  const sidA = await sessionId(A)
  const sidB = await sessionId(B)
  log(`A=${sidA}  B=${sidB}`)

  // AからBへ発信 → Aは peers、Bは onCalledPeers に相手を持つ（この非対称が過去のバグの元）
  await connectPeers(A, sidB)
  await wait(3000)

  await enterRoom(A)
  await enterRoom(B)
  await wait(1500)

  // ─── 共有者Aはカメラをオフにしておく（アバターに隠される不具合の再現条件） ───
  await A.evaluate(() => window.game.scene.keys.game.network.webRTC.toggleVideo())
  await wait(1000)
  log(`Aのカメラ: OFF（この状態で共有すると、以前はB側でアバターに隠されていた）`)

  // ─── A → B の画面共有 ───
  log('\n== A → B の画面共有 ==')
  await A.evaluate(() => window.game.scene.keys.game.network.webRTC.startScreenShare())
  await wait(5000)

  const bView = await peerVideoState(B)
  log('   B側のピア映像要素: ' + JSON.stringify(bView))
  // 同じ相手にpeers/onCalledPeersの2つのwrapperができることがあるため、
  // 実際に映像が流れている方（videoWidth>0）を優先して選ぶ
  const aShare = bView.filter((v) => !v.sessionId || v.sessionId === sidA)
    .sort((x, y) => y.videoW - x.videoW)[0]
  if (!aShare) {
    log('[FAIL] B側にAの映像要素が無い（ピア接続自体が確立していない）')
  } else {
    log(`   B側のA映像: display=${aShare.videoDisplay} size=${aShare.videoW}x${aShare.videoH} アバター表示=${aShare.avatarVisible} objectFit=${aShare.objectFit}`)
    log(aShare.videoDisplay !== 'none' && !aShare.avatarVisible
      ? '[PASS] カメラOFFでも共有映像が表示されている（アバターに隠されていない）'
      : '[FAIL] アバターが被さって共有画面が見えない')
    log(aShare.videoW > 0 ? `[PASS] 共有ストリームが実際に届いている (${aShare.videoW}x${aShare.videoH})` : '[FAIL] 映像トラックが来ていない')
  }
  await B.screenshot({ path: path.join(OUT_DIR, 'ss-01-B-sees-A-share.png') })

  await A.evaluate(() => window.game.scene.keys.game.network.webRTC.stopScreenShare())
  await wait(2500)

  // ─── B → A の画面共有（Bにとって相手は onCalledPeers 側。ここが以前は届かなかった） ───
  log('\n== B → A の画面共有（onCalledPeers経由・以前は届かなかった向き） ==')
  await B.evaluate(() => window.game.scene.keys.game.network.webRTC.startScreenShare())
  await wait(5000)

  const aView = await peerVideoState(A)
  log('   A側のピア映像要素: ' + JSON.stringify(aView))
  const bShare = aView.filter((v) => !v.sessionId || v.sessionId === sidB)
    .sort((x, y) => y.videoW - x.videoW)[0]
  if (!bShare) {
    log('[FAIL] A側にBの映像要素が無い')
  } else {
    log(`   A側のB映像: display=${bShare.videoDisplay} size=${bShare.videoW}x${bShare.videoH} アバター表示=${bShare.avatarVisible}`)
    log(bShare.videoW > 0 && bShare.videoDisplay !== 'none'
      ? '[PASS] 逆向き（onCalledPeers）でも共有映像が届いている'
      : '[FAIL] 逆向きの共有が届いていない')
  }
  await A.screenshot({ path: path.join(OUT_DIR, 'ss-02-A-sees-B-share.png') })

  log(`\nスクリーンショット: ${OUT_DIR}`)
  await browser.close()
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
