// Web Audio API で効果音を生成（ファイル不要）
function getCtx(): AudioContext | null {
  try {
    return new (window.AudioContext || (window as any).webkitAudioContext)()
  } catch {
    return null
  }
}

function beep(freq1: number, freq2: number, duration: number, volume = 0.25) {
  const ctx = getCtx()
  if (!ctx) return
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq1, ctx.currentTime)
  osc.frequency.linearRampToValueAtTime(freq2, ctx.currentTime + duration * 0.8)
  gain.gain.setValueAtTime(volume, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
  osc.start(ctx.currentTime)
  osc.stop(ctx.currentTime + duration)
}

/** 離席：下降音 */
export function playAwaySound() {
  beep(880, 440, 0.35)
}

/** 着席：上昇音 */
export function playPresentSound() {
  beep(440, 880, 0.25)
}

/** ノック通知：ピン×2 */
export function playKnockSound() {
  beep(1047, 900, 0.12)
  setTimeout(() => beep(1047, 900, 0.12), 200)
}

/** エモート送信の小さな確認音 */
export function playEmoteSound() {
  beep(660, 880, 0.15, 0.15)
}

/** チャット投稿の控えめな通知音（短く小さい） */
export function playChatSound() {
  beep(560, 640, 0.06, 0.05)
}
