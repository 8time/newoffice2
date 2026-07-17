/**
 * スタンプのお気に入り。
 *
 * 「よく使う」順は全員の使用回数から決まるが、それとは別に
 * 「自分がよく使うもの」を手元に置きたい。好みは人それぞれなので
 * 全員で共有はせず、自分の端末にだけ覚えておく。
 */
const KEY = 'skyoffice_stamp_favorites'

export function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []
  } catch {}
  return []
}

export function saveFavorites(ids: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(ids)) } catch {}
}

export function toggleFavorite(id: string): string[] {
  const cur = loadFavorites()
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
  saveFavorites(next)
  return next
}
