/**
 * 切断されたあと自動で元の部屋へ戻るための覚え書き。
 *
 * サーバーの再起動（デプロイ）やRender無料枠のスピンダウン、通信の瞬断で接続は切れる。
 * その際に画面内で繋ぎ直そうとすると、前のセッションのキャラやWebRTCの残骸が残って
 * 二重表示などの厄介な状態になりやすい。確実なのは読み込み直すことなので、
 * 「どの部屋に戻るか」だけを控えておき、復帰後に自動で入り直す。
 *
 * タブを閉じたら消えてよい情報なのでsessionStorageに置く（localStorageだと
 * 別の日に開いたときにも復帰しようとしてしまう）。
 */
const KEY = 'skyoffice_reconnect_intent'

export interface ReconnectIntent {
  // 合言葉の固定ルームなら、その合言葉。パブリックロビーなら null
  roomKey: string | null
}

// 退社（明示的な離脱）のときは自動で戻りたくない。ところが退社はページを
// 読み込み直して実現しており、その最中の切断で onLeave が発火して覚え書きを
// 保存してしまう＝せっかく退社したのに自動で入り直してしまう。
// そこで「これは意図した離脱だから保存しないでほしい」という抑止フラグを立てる。
// モジュール変数なので読み込み直せば false に戻る（＝次のセッションには持ち越さない）。
let suppressed = false

export function suppressReconnectSave() {
  suppressed = true
}

export function saveReconnectIntent(intent: ReconnectIntent) {
  if (suppressed) return
  try { sessionStorage.setItem(KEY, JSON.stringify(intent)) } catch {}
}

export function getReconnectIntent(): ReconnectIntent | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return { roomKey: typeof parsed?.roomKey === 'string' ? parsed.roomKey : null }
  } catch {}
  return null
}

export function clearReconnectIntent() {
  try { sessionStorage.removeItem(KEY) } catch {}
}
