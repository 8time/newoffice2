// 固定ルームの合言葉(roomKey)の正規化とURLの読み書き。
// 同じ入力からは必ず同じキーになるようにして、別々の人が同じURL/合言葉で同じ部屋に入れるようにする。

export function normalizeRoomKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_ぁ-んァ-ヶ一-龠]/g, '') // 英数字・ハイフン・日本語のみ許可
    .slice(0, 60)
}

// 現在のURLから固定ルームの合言葉を取り出す（?room=xxx）
export function getRoomKeyFromUrl(): string | null {
  const raw = new URLSearchParams(window.location.search).get('room')
  if (!raw) return null
  const key = normalizeRoomKey(decodeURIComponent(raw))
  return key || null
}

// 現在のURLに ?room=xxx を反映する（履歴は増やさず置き換え）
export function setRoomKeyInUrl(key: string) {
  const url = new URL(window.location.href)
  url.searchParams.set('room', key)
  window.history.replaceState({}, '', url.toString())
}

// 固定ルームの共有URLを組み立てる
export function buildRoomUrl(key: string): string {
  return `${window.location.origin}/?room=${encodeURIComponent(key)}`
}
