/**
 * データの保存先を抽象化する。
 *
 * Renderの無料枠はディスクが再起動・スピンダウンで初期化されるため、ローカルファイルに
 * 保存していた会議室の内容（ホワイトボード・議事録・チャット等）と画像は時間が経つと消えていた。
 * SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY があれば Supabase に保存して永続化し、
 * 未設定ならローカルファイルにフォールバックする（開発時は従来どおりの挙動）。
 *
 * 既存の呼び出し側は同期的にload/saveしているため、JSONは起動時に一括で
 * メモリへ読み込み(hydrate)、以後は同期的に読み、書き込みだけを非同期で流す。
 */
import fs from 'fs'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BUCKET = process.env.SUPABASE_BUCKET || 'uploads'
const TABLE = 'kv'

let client: SupabaseClient | null = null
if (SUPABASE_URL && SUPABASE_KEY) {
  client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  console.log('[Storage] Supabaseに保存します（永続化あり）')
} else {
  console.log('[Storage] ローカルファイルに保存します（SUPABASE_URL未設定。Renderでは再起動で消えます）')
}

export const isRemote = () => client !== null

// key -> ローカルフォールバック時の保存先ファイル
const localFiles = new Map<string, string>()
// 起動時に読み込んだ内容のメモリキャッシュ
const cache = new Map<string, unknown>()
// 書き込み待ちのkey
const dirty = new Set<string>()
let flushTimer: NodeJS.Timeout | undefined

/** 保存するJSONドキュメントを登録する（モジュール読み込み時に呼ぶ） */
export function registerDoc(key: string, localFile: string) {
  localFiles.set(key, localFile)
}

function readLocal(key: string): unknown {
  const file = localFiles.get(key)
  if (!file) return undefined
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (e) {
    console.error(`[Storage] ローカル読み込み失敗 (${key}):`, e)
  }
  return undefined
}

/** 起動時に全ドキュメントをメモリへ読み込む。listen前に必ずawaitすること。 */
export async function hydrate() {
  if (!client) {
    localFiles.forEach((_file, key) => {
      const v = readLocal(key)
      if (v !== undefined) cache.set(key, v)
    })
    return
  }
  // ここで失敗したままローカルの内容で起動すると、空・古い状態を保存済みデータへ
  // 上書きしてしまう（＝データ消失）。読めなかったら起動させない方が安全なので投げる。
  const { data, error } = await client.from(TABLE).select('key, value')
  if (error) throw error
  data?.forEach((row: any) => cache.set(row.key, row.value))
  console.log(`[Storage] Supabaseから${data?.length ?? 0}件読み込みました`)
}

/** メモリキャッシュから同期的に読む（hydrate済み前提） */
export function readDoc<T>(key: string, fallback: T): T {
  const v = cache.get(key)
  return (v === undefined ? fallback : v) as T
}

/** メモリを更新し、保存先への書き込みをまとめて流す */
export function writeDoc(key: string, value: unknown) {
  cache.set(key, value)
  dirty.add(key)
  scheduleFlush(500)
}

function scheduleFlush(delay: number) {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = undefined
    void flush()
  }, delay)
}

async function flush() {
  const keys = Array.from(dirty)
  dirty.clear()
  for (const key of keys) {
    const value = cache.get(key)
    if (value === undefined) continue
    if (client) {
      try {
        const { error } = await client
          .from(TABLE)
          .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
        if (error) throw error
      } catch (e) {
        console.error(`[Storage] Supabaseへの保存に失敗 (${key}):`, e)
        // 書き込みが止まると再試行の機会が無くなるため、ここで再試行を予約する
        dirty.add(key)
        scheduleFlush(5000)
      }
    } else {
      const file = localFiles.get(key)
      if (!file) continue
      try {
        fs.writeFileSync(file, JSON.stringify(value), 'utf-8')
      } catch (e) {
        console.error(`[Storage] ローカル保存に失敗 (${key}):`, e)
      }
    }
  }
}

/** 終了時などに書き込みを確実に流す */
export async function flushNow() {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = undefined
  }
  await flush()
}

// ─── 画像などのバイナリ ────────────────────────────────────────────────

let localBlobDir: string | null = null
/** ローカルフォールバック時の画像保存先を設定する */
export function setLocalBlobDir(dir: string) {
  localBlobDir = dir
}

export async function putBlob(id: string, data: Buffer, contentType: string) {
  if (client) {
    const { error } = await client.storage
      .from(BUCKET)
      .upload(id, data, { contentType, upsert: true })
    if (error) throw error
    return
  }
  if (!localBlobDir) throw new Error('localBlobDir未設定')
  if (!fs.existsSync(localBlobDir)) fs.mkdirSync(localBlobDir, { recursive: true })
  fs.writeFileSync(`${localBlobDir}/${id}`, data)
}

export async function getBlob(id: string): Promise<Buffer | null> {
  if (client) {
    const { data, error } = await client.storage.from(BUCKET).download(id)
    if (error || !data) return null
    return Buffer.from(await data.arrayBuffer())
  }
  if (!localBlobDir) return null
  const file = `${localBlobDir}/${id}`
  if (!fs.existsSync(file)) return null
  return fs.readFileSync(file)
}
