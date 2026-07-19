/**
 * 切断の履歴を localStorage に残し、次の読み込み時にコンソールへ再表示する。
 *
 * 切断すると window.location.reload() で再接続するため、切断時に console.warn しても
 * 「ログ保持(Preserve log)」を有効にしていないとリロードで消えてしまう。しかも
 * タイミングよく見ていないと気づけない。そこで localStorage に貯めておき、再接続後の
 * 読み込み時にまとめて表示する。これで「何番で・何分間隔で」切れているかが後から分かる。
 */
const KEY = 'skyoffice_disconnect_log'
const MAX = 40

export interface DisconnectEntry {
  t: number      // 切断時刻(ms)
  code: number   // WebSocketのcloseコード
  reason: string // 人が読める説明
}

export function getDisconnectLog(): DisconnectEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function recordDisconnect(code: number, reason: string) {
  try {
    const log = getDisconnectLog()
    log.push({ t: Date.now(), code, reason })
    while (log.length > MAX) log.shift()
    localStorage.setItem(KEY, JSON.stringify(log))
  } catch {}
}

export function clearDisconnectLog() {
  try { localStorage.removeItem(KEY) } catch {}
}

// closeコードを短いラベルにする（パネル・console.table共通）
export function codeLabel(code: number): string {
  switch (code) {
    case -1: return '通話(PeerJS)'
    case 1000: return '正常終了'
    case 1001: return '離脱'
    case 1006: return '経路が無言で切断'
    case 1011: return 'サーバー内部エラー'
    case 1012: return 'サーバー再起動'
    case 4000: return '別タブ'
    default: return `code=${code}`
  }
}

// 秒を「X秒」「X分Y秒」に整形
export function formatGap(sec: number): string {
  if (sec < 60) return `${sec}秒`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s ? `${m}分${s}秒` : `${m}分`
}

// console.table用に、時刻・種別・説明・前回からの間隔を人が読める形へ
export function getDisconnectLogRows() {
  const log = getDisconnectLog()
  let prev = 0
  return log.map((e) => {
    const row = {
      時刻: new Date(e.t).toLocaleString(),
      種別: `${codeLabel(e.code)} (code=${e.code})`,
      前回から: prev ? formatGap(Math.round((e.t - prev) / 1000)) : '-',
      説明: e.reason,
    }
    prev = e.t
    return row
  })
}

// 再接続後の読み込み時に、貯まった切断履歴をコンソールへ出す。
// 前回からの間隔も出すので、1〜3分周期などの規則性が一目で分かる。
export function printDisconnectLog() {
  const log = getDisconnectLog()
  if (log.length === 0) return
  console.group(`%c[切断履歴] 直近${log.length}件 — window.__disconnectLog() でいつでも再表示`, 'color:#e6a23c;font-weight:bold')
  let prev = 0
  for (const e of log) {
    const time = new Date(e.t).toLocaleString()
    const gap = prev ? `（前回から ${Math.round((e.t - prev) / 1000)} 秒）` : ''
    console.log(`${time}  code=${e.code} ${e.reason} ${gap}`)
    prev = e.t
  }
  console.log('%ccodeの意味: 1006=経路が無言で切断(アイドル切断が濃厚) / 1001=離脱 / 1011・1012=サーバー側 / 4000=別タブ / -1=PeerJS(通話の署名サーバー)切断', 'color:#888')
  console.log('履歴を消すには window.__clearDisconnectLog()')
  // 表形式でも出す（見やすい）。コンソールに入力できなくても、これは自動で出る
  try { console.table(getDisconnectLogRows()) } catch {}
  console.groupEnd()
}
