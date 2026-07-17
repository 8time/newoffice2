/**
 * 使われなくなった古いアップロードファイルを片付ける。
 *
 * ホワイトボードの画像やチャットの添付は /api/files に上がり、消す仕組みが無かったため
 * 増える一方だった（テキストは1KB程度なのに対し、ファイルは1件あたり平均700KBある）。
 * Supabaseの無料枠はストレージ1GBなので、放っておくといずれ満杯になる。
 *
 * 消してよいのは「充分に古く、かつどこからも参照されていない」ファイルだけ。
 * 主にチャットの添付が該当する（チャット履歴にファイルは記録されないため、
 * 時間が経つと誰からも開けない置き去りのファイルになる）。
 * ホワイトボードに貼られた画像はスナップショットから参照され続けるので消さない。
 */
import { snapshotDocs, readDoc, writeDoc, deleteBlob } from './storage'

// これより古く、かつ参照されていないファイルを削除の対象にする
const FILE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000 // 30日
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000 // 1日ごと
// Supabase無料枠のストレージ上限（1GB）。使用量の目安に使う。
// 環境変数で上げられるようにしておく（有料プランに変えたときのため）
const STORAGE_LIMIT_BYTES = Number(process.env.STORAGE_LIMIT_BYTES) || 1024 * 1024 * 1024

interface UploadRecord {
  name: string
  type: string
  size: number
  created: number
}

/**
 * 保存中のデータから、まだ参照されているアップロードIDを集める。
 * ホワイトボードは "/files/f_xxx" というURLで画像を参照している。
 * 取りこぼすと使用中の画像を消してしまうため、特定のドキュメントに絞らず
 * 全ドキュメントの中身を対象に探す（新しい機能が参照を増やしても安全side）。
 */
export function collectReferencedFileIds(): Set<string> {
  const ids = new Set<string>()
  const docs = snapshotDocs()
  for (const [key, value] of Object.entries(docs)) {
    // uploadIndexは全ファイルのIDを持つ台帳そのものなので、
    // これを参照として数えると何一つ消せなくなる
    if (key === 'uploadIndex') continue
    const json = JSON.stringify(value)
    if (!json) continue
    const re = /\/files\/(f_[A-Za-z0-9_]+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(json)) !== null) ids.add(m[1])
  }
  return ids
}

export async function cleanupOldFiles() {
  const index = readDoc<Record<string, UploadRecord>>('uploadIndex', {})
  const entries = Object.entries(index)
  if (entries.length === 0) return

  const referenced = collectReferencedFileIds()

  // 安全弁。ホワイトボードに画像が貼ってあるのに参照が1つも見つからない場合、
  // 参照の探し方が壊れている可能性が高い。そのまま進めると使用中の画像を
  // 全部消してしまい、二度と直せない「ダミー画像」になる。何もせず中止する。
  const whiteboards = readDoc<Record<string, any>>('whiteboards', {})
  const hasImageOnBoard = Object.values(whiteboards).some((snap) =>
    Array.isArray(snap?.elements) && snap.elements.some((el: any) => el?.type === 'image' && !el?.isDeleted)
  )
  if (hasImageOnBoard && referenced.size === 0) {
    console.error('[Cleanup] 中止: ホワイトボードに画像があるのに参照を検出できませんでした。' +
      '参照の判定が壊れている可能性があるため、削除は行いません。')
    return
  }

  const cutoff = Date.now() - FILE_RETENTION_MS
  const targets = entries.filter(
    ([id, rec]) => rec && rec.created < cutoff && !referenced.has(id)
  )
  if (targets.length === 0) {
    console.log(`[Cleanup] 削除対象なし（保存${entries.length}件 / 使用中${referenced.size}件）`)
    return
  }

  let deleted = 0
  let freed = 0
  for (const [id, rec] of targets) {
    try {
      await deleteBlob(id)
      delete index[id]
      deleted++
      freed += rec.size || 0
    } catch (e) {
      // 消せなかったものは台帳に残す（次回また試す）
      console.error(`[Cleanup] 削除失敗 (${id}):`, e)
    }
  }
  if (deleted > 0) writeDoc('uploadIndex', index)
  console.log(
    `[Cleanup] 古い未使用ファイルを${deleted}件削除（約${Math.round(freed / 1024)}KB / 残り${Object.keys(index).length}件）`
  )
}

/**
 * 今どれだけ容量を使っているかを返す。利用者が自分で見て消せるようにするための情報。
 * 参照中かどうかも返し、使用中のファイルを誤って消させないようにする。
 */
export function getUsage() {
  const index = readDoc<Record<string, UploadRecord>>('uploadIndex', {})
  const referenced = collectReferencedFileIds()
  const files = Object.entries(index).map(([id, rec]) => ({
    id,
    name: rec.name,
    type: rec.type,
    size: rec.size || 0,
    created: rec.created,
    // 使用中＝ホワイトボード等から参照されている。消すと画像が表示されなくなる
    inUse: referenced.has(id),
  }))
  files.sort((a, b) => b.size - a.size)
  const usedBytes = files.reduce((s, f) => s + f.size, 0)

  // 保存しているJSON（チャット・看板など）の大きさ
  const docs = snapshotDocs()
  let docBytes = 0
  for (const value of Object.values(docs)) {
    try { docBytes += JSON.stringify(value)?.length || 0 } catch {}
  }

  return {
    // Supabase無料枠のストレージ上限。これに対してどれだけ使っているかを見せる
    limitBytes: STORAGE_LIMIT_BYTES,
    usedBytes,
    docBytes,
    percent: Math.min(100, Math.round((usedBytes / STORAGE_LIMIT_BYTES) * 1000) / 10),
    fileCount: files.length,
    retentionDays: FILE_RETENTION_MS / (24 * 60 * 60 * 1000),
    files,
  }
}

/** 利用者が画面から手動で消す。使用中のファイルは拒否する */
export async function deleteFileManually(id: string): Promise<{ ok: boolean; reason?: string }> {
  const index = readDoc<Record<string, UploadRecord>>('uploadIndex', {})
  if (!index[id]) return { ok: false, reason: 'not-found' }
  if (collectReferencedFileIds().has(id)) {
    // 使用中のものを消すと、ホワイトボードの画像が二度と直せないダミーになる
    return { ok: false, reason: 'in-use' }
  }
  await deleteBlob(id)
  delete index[id]
  writeDoc('uploadIndex', index)
  return { ok: true }
}

/** 起動時と1日ごとに片付ける */
export function startFileCleanup() {
  cleanupOldFiles().catch((e) => console.error('[Cleanup] 失敗:', e))
  const timer = setInterval(() => {
    cleanupOldFiles().catch((e) => console.error('[Cleanup] 失敗:', e))
  }, CLEANUP_INTERVAL_MS)
  timer.unref?.()
}
