/**
 * WebRTCの音声コーデック(Opus)に、負荷ゼロで通話の頑丈さを上げる設定を入れる。
 *
 *  - useinbandfec=1 : 前方誤り訂正(FEC)。少しのパケットロスなら音を復元でき、
 *                     不安定回線での「音切れ・ブツ切れ」が減る。
 *  - usedtx=1       : 無音時は送信を止める(DTX)。無音区間の帯域を節約でき、
 *                     Render無料枠のような細い回線でも詰まりにくくなる。
 *  - stereo=0       : 音声はモノラルで十分（既定だが明示）。
 *
 * ビットレートは固定せず、ブラウザの自動調整に任せる（良回線でも悪回線でも
 * 適応する方が安全なため、あえて maxaveragebitrate は指定しない）。
 *
 * PeerJS の call()/answer() の sdpTransform に渡して、生成されたSDPのOpus設定を
 * 書き換える。純粋関数なのでブラウザ無しで単体テストできる。
 */
export function preferOpusDtxFec(sdp: string): string {
  if (!sdp) return sdp
  const lines = sdp.split(/\r\n|\n/)

  // Opusのペイロード番号を集める（環境で111とは限らない）
  const opusPts = new Set<string>()
  for (const line of lines) {
    const m = line.match(/^a=rtpmap:(\d+)\s+opus\/48000/i)
    if (m) opusPts.add(m[1])
  }
  if (opusPts.size === 0) return sdp

  const fmtpSeen = new Set<string>()
  const out: string[] = []
  for (const line of lines) {
    const fm = line.match(/^a=fmtp:(\d+)\s+(.*)$/)
    if (fm && opusPts.has(fm[1])) {
      fmtpSeen.add(fm[1])
      out.push(`a=fmtp:${fm[1]} ${ensureOpusParams(fm[2])}`)
      continue
    }
    out.push(line)
    // rtpmap の直後に fmtp が無いOpusは、ここでfmtp行を補う
    const rm = line.match(/^a=rtpmap:(\d+)\s+opus\/48000/i)
    if (rm && !hasFmtpLater(lines, rm[1])) {
      out.push(`a=fmtp:${rm[1]} ${ensureOpusParams('')}`)
    }
  }
  return out.join('\r\n')
}

function hasFmtpLater(lines: string[], pt: string): boolean {
  return lines.some((l) => l.startsWith(`a=fmtp:${pt} `))
}

// 既存パラメータを壊さずに FEC/DTX/stereo を上書き・追加する
function ensureOpusParams(params: string): string {
  const kv = new Map<string, string>()
  for (const p of params.split(';')) {
    const t = p.trim()
    if (!t) continue
    const eq = t.indexOf('=')
    if (eq === -1) kv.set(t, '')
    else kv.set(t.slice(0, eq), t.slice(eq + 1))
  }
  kv.set('useinbandfec', '1')
  kv.set('usedtx', '1')
  if (!kv.has('stereo')) kv.set('stereo', '0')
  return [...kv.entries()].map(([k, v]) => (v === '' ? k : `${k}=${v}`)).join(';')
}
