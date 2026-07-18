/**
 * 実ブラウザ(Chrome)が生成した本物のOffer SDPに、アプリの実関数 preferOpusDtxFec を
 * 適用し、
 *   - Opus に usedtx=1 / useinbandfec=1 が入る
 *   - 変換後SDPを Chrome が setLocalDescription で受理する（＝壊れていない・通話が成立する形）
 * ことを検証する。2クライアントの署名サーバー確立に依存しないため安定して回る。
 * （変換ロジックの網羅は scripts/test-sdp-opus.js の単体テスト側で担保）
 */
const { chromium } = require('playwright')
const log = console.log
let failed = 0
const check = (c, ok, ng) => { log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }

async function main() {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1200, height: 800 } })
  const p = await ctx.newPage()
  await p.goto('http://localhost:5173')
  await p.waitForFunction(() => window.__store?.getState().room.lobbyJoined === true, { timeout: 30000 })
  await p.waitForFunction(() => window.game?.scene?.keys?.bootstrap?.preloadComplete === true, { timeout: 30000 })
  // 入室するとWebRTCが生成され、dev公開の実関数 __preferOpusDtxFec が使えるようになる
  await p.getByRole('button', { name: 'パブリックロビーに接続' }).click()
  await p.waitForFunction(() => window.__store?.getState().room.roomJoined === true, { timeout: 30000 })
  await p.waitForFunction(() => typeof window.__preferOpusDtxFec === 'function', { timeout: 30000 })

  const r = await p.evaluate(async () => {
    const fn = window.__preferOpusDtxFec
    const pc = new RTCPeerConnection()
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => pc.addTrack(t, stream))
    const offer = await pc.createOffer()
    const original = offer.sdp || ''
    const transformed = fn(original)
    let accepted = false
    let err = null
    try {
      await pc.setLocalDescription({ type: 'offer', sdp: transformed })
      accepted = true
    } catch (e) {
      err = String(e)
    }
    const opusFmtp = transformed.split(/\r\n|\n/).find((l) => /^a=fmtp:\d+ .*opus|usedtx/.test(l)) ||
      transformed.split(/\r\n|\n/).find((l) => /usedtx/.test(l)) || ''
    pc.close()
    stream.getTracks().forEach((t) => t.stop())
    return {
      hadOpus: /opus\/48000/i.test(original),
      origHasDtx: /usedtx=1/.test(original),
      transHasDtx: /usedtx=1/.test(transformed),
      transHasFec: /useinbandfec=1/.test(transformed),
      accepted, err, opusFmtp,
    }
  })

  log('   結果: ' + JSON.stringify(r))
  check(r.hadOpus, 'Chromeの生成SDPにOpusが含まれる（前提）', 'Opusが無い')
  check(r.transHasDtx, '変換後SDPに usedtx=1(DTX) が入っている', 'usedtxが入っていない')
  check(r.transHasFec, '変換後SDPに useinbandfec=1(FEC) が入っている', 'FECが入っていない')
  check(r.accepted, 'ChromeがsetLocalDescriptionで変換後SDPを受理（壊れていない）', `拒否された: ${r.err}`)
  if (r.origHasDtx) log('   （注: Chromeの元SDPに既にusedtxがあった＝冪等性が効いている）')

  log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
  await browser.close()
  process.exit(failed === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
