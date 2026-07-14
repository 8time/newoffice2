// ColyseusサーバーのHTTP APIのベースURLを返す。
// WebSocket接続先の解決方法（Network.tsのコンストラクタ）と必ず同じ規則にすること：
//   本番: VITE_SERVER_URL（ws(s)://…）→ http(s)に読み替え。未設定ならクライアント配信元と同一オリジン
//   開発: 同一ホストの :2567
export function getServerHttpBase(): string {
  if (process.env.NODE_ENV === 'production') {
    const wsUrl = import.meta.env.VITE_SERVER_URL as string | undefined
    if (wsUrl) return wsUrl.replace(/^ws/, 'http')
    return window.location.origin
  }
  return `${window.location.protocol}//${window.location.hostname}:2567`
}

// サーバーが返す相対パス（例: /files/f_xxx）を絶対URLに解決する
export function resolveServerUrl(pathOrUrl: string): string {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl
  return getServerHttpBase() + pathOrUrl
}
