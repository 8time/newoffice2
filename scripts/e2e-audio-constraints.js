/**
 * マイクにエコー除去・ノイズ抑制・自動音量調整が有効化されているか検証する。
 * getUserMedia で取得した音声トラックの settings/constraints を実機で読む。
 */
const { chromium } = require('playwright')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = console.log
let failed = 0
const check = (c, ok, ng) => { log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }

async function main() {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1300, height: 850 } })
  const p = await ctx.newPage()
  await p.goto('http://localhost:5173')
  await p.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await p.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
  await p.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await p.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 30000 })
  await p.locator('input[type="text"]').first().fill('音声テスト')
  await p.getByRole('button', { name: '入室する' }).click()
  await p.waitForSelector('text=チャット', { timeout: 20000 })
  await wait(2500)

  // 実際にアプリが getUserMedia した音声トラックの制約を読む。
  // fakeデバイスでも、要求した制約は constraints に反映される（getConstraints）。
  const audioInfo = await p.evaluate(() => {
    const rtc = window.game?.scene?.keys?.game?.network?.webRTC
    const stream = rtc?.myStream
    if (!stream) return { hasStream: false }
    const track = stream.getAudioTracks()[0]
    if (!track) return { hasStream: true, hasAudio: false }
    return {
      hasStream: true,
      hasAudio: true,
      constraints: track.getConstraints(),
      settings: track.getSettings(),
    }
  })
  log('   音声トラック情報: ' + JSON.stringify(audioInfo))

  check(audioInfo.hasStream && audioInfo.hasAudio, '音声トラックが取得できている', 'ストリーム/音声トラックが無い')

  // 要求した制約に3つの音声処理が入っているか（アプリが指定しているかの確認）
  const c = audioInfo.constraints || {}
  check(c.echoCancellation === true, 'echoCancellation(エコー除去)を要求している', `要求されていない: ${JSON.stringify(c)}`)
  check(c.noiseSuppression === true, 'noiseSuppression(ノイズ抑制)を要求している', `要求されていない: ${JSON.stringify(c)}`)
  check(c.autoGainControl === true, 'autoGainControl(自動音量)を要求している', `要求されていない: ${JSON.stringify(c)}`)

  // settings にも反映されていれば、ブラウザが実際に適用したことの裏付け（fakeデバイス依存）
  const s = audioInfo.settings || {}
  log(`   実適用(settings): echo=${s.echoCancellation} noise=${s.noiseSuppression} agc=${s.autoGainControl}`)

  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  await browser.close()
  process.exit(failed === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
