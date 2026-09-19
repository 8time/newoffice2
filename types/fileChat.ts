/** 通常の発言と区別するための接頭辞。チャット履歴の content に載せる */
export const FILE_CHAT_PREFIX = '[filejson]'

export type FileChatPayload = {
  name: string
  type: string
  url: string
  size: number
}

export function encodeFileChat(file: FileChatPayload): string {
  const storedUrl = toStoredFileUrl(file.url)
  return (
    FILE_CHAT_PREFIX +
    JSON.stringify({
      name: String(file.name || 'file').slice(0, 300),
      type: String(file.type || ''),
      url: storedUrl.slice(0, 2000),
      size: Number(file.size) || 0,
    })
  )
}

export function parseFileChat(content: string | undefined | null): FileChatPayload | null {
  if (!content || !content.startsWith(FILE_CHAT_PREFIX)) return null
  try {
    const raw = JSON.parse(content.slice(FILE_CHAT_PREFIX.length))
    if (!raw || typeof raw.url !== 'string' || !raw.url) return null
    return {
      name: String(raw.name || 'file'),
      type: String(raw.type || ''),
      url: raw.url,
      size: Number(raw.size) || 0,
    }
  } catch {
    return null
  }
}

/** 保存は相対パスにして、接続先が変わっても開けるようにする */
export function toStoredFileUrl(url: string): string {
  try {
    const path = url.startsWith('/') ? url : new URL(url).pathname
    if (path.startsWith('/files/')) return path
  } catch {
    /* keep original */
  }
  return url
}
