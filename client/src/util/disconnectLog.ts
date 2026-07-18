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
  console.log('%ccodeの意味: 1006=経路が無言で切断(アイドル切断が濃厚) / 1001=離脱 / 1011・1012=サーバー側 / 4000=別タブ', 'color:#888')
  console.log('履歴を消すには window.__clearDisconnectLog()')
  console.groupEnd()
}
