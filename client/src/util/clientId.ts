// ブラウザごとに固定のID。リロードや再接続をまたいで同じ値になる。
// サーバーはこのIDで「同じブラウザからの古い接続（幽霊キャラ）」を検出して排除し、
// 1つのブラウザ = 1キャラにする。
const KEY = 'skyoffice_client_id'

export function getClientId(): string {
  try {
    let id = localStorage.getItem(KEY)
    if (!id) {
      id = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      localStorage.setItem(KEY, id)
    }
    return id
  } catch {
    // localStorageが使えない環境ではセッション限りのIDにフォールバック
    return `c_${Math.random().toString(36).slice(2, 12)}`
  }
}
