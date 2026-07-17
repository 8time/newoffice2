/**
 * 画像をアップロードする前にブラウザ側で縮小する。
 *
 * スマホの写真は4032×3024などで数MBある一方、チャットの吹き出しやホワイトボード上では
 * せいぜい数百px幅でしか表示されない。原寸のまま送ると、保存容量・通信量・
 * 相手の読み込み時間のすべてを無駄に使う。
 *
 * サーバー側で縮小する手もあるが、送る前に小さくした方が通信量とサーバーのメモリも
 * 同時に節約できるため、ブラウザ側で縮小する。
 */

// 表示に使う最大の辺。これ以上大きくしても画面上では違いが分からない
const DEFAULT_MAX_SIZE = 1600
// WebPは同じ見た目でJPEGより小さい。画質85なら写真でも劣化はほぼ分からない
const DEFAULT_QUALITY = 0.85

// 縮小しても意味がない・してはいけないもの
//  - GIF: アニメーションが1コマ目だけになってしまう
//  - SVG: 拡大しても劣化しない上、画素化すると台無しになる
const SKIP_TYPES = /^image\/(gif|svg\+xml)$/i

export interface ShrinkOptions {
  maxSize?: number
  quality?: number
}

/**
 * 画像なら縮小したBlobを返す。画像でない・縮小の必要がない・失敗した場合は
 * 元のファイルをそのまま返す（送信そのものを失敗させない）。
 */
export async function shrinkImageFile(file: File, opts: ShrinkOptions = {}): Promise<File> {
  const maxSize = opts.maxSize ?? DEFAULT_MAX_SIZE
  const quality = opts.quality ?? DEFAULT_QUALITY

  if (!file.type.startsWith('image/') || SKIP_TYPES.test(file.type)) return file

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
    // 既に小さい画像を再エンコードすると、かえって大きくなることがあるので触らない
    if (scale === 1) {
      bitmap.close?.()
      return file
    }

    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', quality)
    )
    if (!blob || blob.size >= file.size) return file // 小さくならないなら元のまま

    const name = file.name.replace(/\.[^/.]+$/, '') + '.webp'
    return new File([blob], name, { type: 'image/webp' })
  } catch {
    // 対応していない形式や壊れた画像。縮小をあきらめて元のまま送る
    return file
  }
}

/** dataURL（ホワイトボードの画像はこの形で持っている）を縮小してBlobにする */
export async function shrinkDataUrl(
  dataURL: string,
  mimeType: string,
  opts: ShrinkOptions = {}
): Promise<{ blob: Blob; mimeType: string }> {
  const [meta, b64] = dataURL.split(',')
  const type = mimeType || /data:([^;]+)/.exec(meta)?.[1] || 'image/png'
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const original = new Blob([bytes], { type })

  if (!type.startsWith('image/') || SKIP_TYPES.test(type)) return { blob: original, mimeType: type }

  const file = new File([original], 'image', { type })
  const shrunk = await shrinkImageFile(file, opts)
  return { blob: shrunk, mimeType: shrunk.type || type }
}
