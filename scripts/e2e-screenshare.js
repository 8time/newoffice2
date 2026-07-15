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
  // getDisplayMediaをcanvas captureStreamで偽装（ヘッドレスでは本物が使えない）。
  // 「共有した動画の音声」を再現するため、映像に加えて音声トラック（1kHzの音）も付ける。
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
      const video = c.captureStream(15).getVideoTracks()[0]

      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      osc.frequency.value = 1000
      const dest = ctx.createMediaStreamDestination()
      osc.connect(dest)
      osc.start()
      const audio = dest.stream.getAudioTracks()[0]

      return new MediaStream([video, audio])
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

  // ─── 共有者AはカメラOFF・マイクもミュートにする ───
  // マイクをミュートしておくことで、B側で聞こえる音は「画面共有の音声」だけになり、
  // 共有音がちゃんと届いているかを厳密に判定できる。
  await A.evaluate(() => {
    const rtc = window.game.scene.keys.game.network.webRTC
    rtc.toggleVideo()
    rtc.setMuted(true)
  })
  await wait(1000)
  log('Aのカメラ: OFF / マイク: ミュート（聞こえる音は画面共有の音声だけになる）')

  // ─── A → B の画面共有 ───
  log('\n== A → B の画面共有 ==')
  await A.evaluate(() => window.game.scene.keys.game.network.webRTC.startScreenShare())
  await wait(5000)

  // 仕様: 共有中は小さいタイルは相手のキャラ（アバター）を表示し、
  // 共有画面は大きい表示エリアだけに出す。
  const bView = await peerVideoState(B)
  log('   B側のピア映像要素: ' + JSON.stringify(bView))
  const aTile = bView.filter((v) => !v.sessionId || v.sessionId === sidA)[0]
  if (aTile) {
    log(aTile.avatarVisible
      ? '[PASS] 小さいタイルは相手のキャラ（アバター）が表示され、共有画面で埋まっていない'
      : '[FAIL] 小さいタイルが共有画面で埋まっている')
  }
  // 大きい表示エリアに共有映像が来ているか
  const bigStage = await B.evaluate(() => {
    const vids = [...document.querySelectorAll('video')].filter((v) => v.videoWidth >= 320 && !v.closest('.peer-video-wrapper'))
    const v = vids.sort((a, b) => b.videoWidth - a.videoWidth)[0]
    return v ? { w: v.videoWidth, h: v.videoHeight } : null
  })
  log(bigStage && bigStage.w > 0
    ? `[PASS] 大きい表示に共有映像が届いている (${bigStage.w}x${bigStage.h})`
    : '[FAIL] 大きい表示に共有映像が来ていない')

  // ─── 共有した動画の音声が届いているか（B側で受信音の音量を実測する） ───
  // Aはマイクをミュートしているので、音が聞こえるなら画面共有の音声が届いている証拠になる。
  const level = await B.evaluate(async () => {
    // タイル・大表示のどれでもよいので、音声トラックを持つvideoを探す
    const vids = [...document.querySelectorAll('video')]
    const withAudio = vids.find((v) => v.srcObject && v.srcObject.getAudioTracks && v.srcObject.getAudioTracks().length > 0)
    const stream = withAudio && withAudio.srcObject
    const track = stream && stream.getAudioTracks()[0]
    if (!track) return { hasAudioTrack: false, rms: 0 }

    const ctx = new AudioContext()
    const src = ctx.createMediaStreamSource(new MediaStream([track]))
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    src.connect(analyser)
    const buf = new Float32Array(analyser.fftSize)

    let peak = 0
    for (let i = 0; i < 40; i++) {
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let j = 0; j < buf.length; j++) sum += buf[j] * buf[j]
      peak = Math.max(peak, Math.sqrt(sum / buf.length))
      await new Promise((r) => setTimeout(r, 100))
    }
    ctx.close()
    return { hasAudioTrack: true, rms: peak }
  })
  log(`   B側で受信した音声のレベル: ${JSON.stringify(level)}`)
  log(level.hasAudioTrack && level.rms > 0.01
    ? '[PASS] 共有した動画の音声がBに届いている（Aはマイクをミュート中なので共有音のみ）'
    : '[FAIL] 共有音声が届いていない（無音）')

  // ─── カメラ列から共有者のタイルが消えていないか ───
  const columnTiles = await B.evaluate(() => {
    const labels = [...document.querySelectorAll('.cam-label')].map((e) => e.textContent)
    return { labels, peerTiles: document.querySelectorAll('.peer-video-wrapper').length }
  })
  log(`   B側のカメラ列: ${JSON.stringify(columnTiles.labels)}`)
  log(columnTiles.labels.length >= 2
    ? '[PASS] 共有中もカメラ列に自分と相手の両方が残っている'
    : '[FAIL] カメラ列からタイルが消えている')

  await B.screenshot({ path: path.join(OUT_DIR, 'ss-01-B-sees-A-share.png') })

  await A.evaluate(() => window.game.scene.keys.game.network.webRTC.stopScreenShare())
  await wait(2500)

  // ─── B → A の画面共有（Bにとって相手は onCalledPeers 側。ここが以前は届かなかった） ───
  log('\n== B → A の画面共有（onCalledPeers経由・以前は届かなかった向き） ==')
  await B.evaluate(() => window.game.scene.keys.game.network.webRTC.startScreenShare())
  await wait(5000)

  const aBigStage = await A.evaluate(() => {
    const vids = [...document.querySelectorAll('video')].filter((v) => v.videoWidth >= 320 && !v.closest('.peer-video-wrapper'))
    const v = vids.sort((a, b) => b.videoWidth - a.videoWidth)[0]
    return v ? { w: v.videoWidth, h: v.videoHeight } : null
  })
  log(aBigStage && aBigStage.w > 0
    ? `[PASS] 逆向き（onCalledPeers）でも共有映像が大きい表示に届いている (${aBigStage.w}x${aBigStage.h})`
    : '[FAIL] 逆向きの共有が届いていない')
  await A.screenshot({ path: path.join(OUT_DIR, 'ss-02-A-sees-B-share.png') })

  log(`\nスクリーンショット: ${OUT_DIR}`)
  await browser.close()
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
