/**
 * マイク取得時の音声処理オプション。
 *
 * これまで getUserMedia は audio:true だけで、ブラウザ標準の音声処理を明示的に
 * 有効化していなかった。以下を明示すると、Chrome等に内蔵の WebRTC Audio Processing
 * Module（DiscordやMeetと同じ系統）が働く。追加ライブラリ不要・CPU負荷ほぼゼロで、
 * キーボード音・エアコン・ハウリング（自分の声の回り込み）を実用十分に抑えられる。
 *
 *  - echoCancellation : スピーカーから出た相手の声がマイクに回り込むのを消す（ハウリング防止）
 *  - noiseSuppression : 定常ノイズ（ファン・エアコン・ホワイトノイズ）を抑える
 *  - autoGainControl  : 声の大小を自動でならして聞き取りやすくする
 *
 * さらに強力な RNNoise 等は AudioWorklet+WASM が必要で負荷も上がるため、
 * まずは標準機能で底上げする。
 */
export const AUDIO_PROCESSING: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

/**
 * デバイスID指定（任意）に音声処理オプションを合わせた audio 制約を作る。
 * micId が無ければ既定デバイス＋音声処理。
 */
export function buildAudioConstraints(micId?: string): MediaTrackConstraints {
  return micId
    ? { deviceId: { exact: micId }, ...AUDIO_PROCESSING }
    : { ...AUDIO_PROCESSING }
}
