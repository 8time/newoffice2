/**
 * preferOpusDtxFec の単体テスト（ブラウザ不要・純粋関数）。
 * TSを直接requireできないので、実装と同じロジックをここにも書かず、
 * ts-nodeで本体を読み込んで検証する。
 */
const path = require('path')
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', target: 'es2019', esModuleInterop: true },
})
const { preferOpusDtxFec } = require(path.join(__dirname, '..', 'client', 'src', 'util', 'sdpOpus.ts'))

let failed = 0
const check = (c, ok, ng) => { console.log(c ? `[PASS] ${ok}` : `[FAIL] ${ng}`); if (!c) failed++ }

// 1. 典型的なChromeのOpus SDP（fmtpあり）
const sdp1 = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 103',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:103 ISAC/16000',
  '',
].join('\r\n')
const out1 = preferOpusDtxFec(sdp1)
console.log('--- 変換後(fmtpあり) ---\n' + out1)
const fmtp1 = out1.split(/\r\n/).find((l) => l.startsWith('a=fmtp:111'))
check(/usedtx=1/.test(fmtp1), 'usedtx=1 が追加される', `usedtx無し: ${fmtp1}`)
check(/useinbandfec=1/.test(fmtp1), 'useinbandfec=1 が保たれる', `fec無し: ${fmtp1}`)
check(/minptime=10/.test(fmtp1), '既存パラメータ(minptime)が壊れない', `minptime消えた: ${fmtp1}`)
check(/stereo=0/.test(fmtp1), 'stereo=0 が入る', `stereo無し: ${fmtp1}`)
// 他コーデック行は触らない
check(out1.includes('a=rtpmap:103 ISAC/16000'), '他コーデック行はそのまま', 'ISAC行が壊れた')
// CRLFが保たれる
check(out1.includes('\r\n'), 'CRLFの改行が保たれる', '改行が壊れた')

// 2. Opus payload番号が111以外
const sdp2 = ['a=rtpmap:96 opus/48000/2', 'a=fmtp:96 minptime=10', ''].join('\r\n')
const out2 = preferOpusDtxFec(sdp2)
const fmtp2 = out2.split(/\r\n/).find((l) => l.startsWith('a=fmtp:96'))
check(/usedtx=1/.test(fmtp2) && /useinbandfec=1/.test(fmtp2), 'payload番号が違っても効く(96)', `効いてない: ${fmtp2}`)

// 3. fmtp行が無いOpus → 補われる
const sdp3 = ['a=rtpmap:111 opus/48000/2', 'a=rtpmap:0 PCMU/8000', ''].join('\r\n')
const out3 = preferOpusDtxFec(sdp3)
const fmtp3 = out3.split(/\r\n/).find((l) => l.startsWith('a=fmtp:111'))
check(!!fmtp3 && /usedtx=1/.test(fmtp3) && /useinbandfec=1/.test(fmtp3), 'fmtp行が無ければ補われる', `補われない: ${out3}`)

// 4. Opusが無いSDPは素通し（壊さない）
const sdp4 = ['m=video 9 UDP/TLS/RTP/SAVPF 96', 'a=rtpmap:96 VP8/90000', ''].join('\r\n')
const out4 = preferOpusDtxFec(sdp4)
check(out4 === sdp4, 'Opusが無いSDPは変更しない', 'Opus無しなのに変わった')

// 5. 二重適用しても壊れない（冪等）
const twice = preferOpusDtxFec(preferOpusDtxFec(sdp1))
const fmtp5 = twice.split(/\r\n/).find((l) => l.startsWith('a=fmtp:111'))
const dtxCount = (fmtp5.match(/usedtx=1/g) || []).length
check(dtxCount === 1, '二重適用してもusedtxは1個だけ（冪等）', `重複した: ${fmtp5}`)

console.log(failed === 0 ? '\n=== 全項目 PASS ===' : `\n=== ${failed}件 FAIL ===`)
process.exit(failed === 0 ? 0 : 1)
