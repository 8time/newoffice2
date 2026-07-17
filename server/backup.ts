/**
 * 会議室の内容などを自動でバックアップする（世代管理）。
 *
 * Supabaseに保存しているので「サーバーが再起動しても消えない」状態にはなったが、
 * それは「壊れない」保証ではない。保存先は常に上書きされるため、
 *   ・機能の追加や変更で保存形式を壊してしまった
 *   ・古い内容を持ったクライアントが上書きしてしまった
 *   ・誰かが誤って全消しした
 * といった場合、元に戻す手段が無かった。
 *
 * そこで内容が変わったときだけ世代を残し、いつでも過去の状態へ戻せるようにする。
 * 変わっていなければ書かないので、使っていない間は容量も増えない。
 */
import crypto from 'crypto'
import { readDoc, writeDoc, putBackup, listBackups, getBackup, deleteBackup } from './storage'

// 失うと困るデータ。特にホワイトボードと議事録は会議の成果物そのもの
const TARGETS = ['whiteboards', 'meetingDocs', 'meetingTabs', 'signboards', 'builder', 'chat'] as const
type Target = typeof TARGETS[number]

const CHECK_INTERVAL_MS = 10 * 60 * 1000 // 10分ごとに変化を確認
// 直近はこまめに、古いものは1日1本だけ残す（容量と復元しやすさの折り合い）
const KEEP_RECENT = 12
const KEEP_DAILY_DAYS = 30

const hashOf = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v) || '').digest('hex')

// 直前に取ったバックアップの中身。変化が無ければ書かないための比較用
const lastHash = new Map<Target, string>()

const nameOf = (target: string, iso: string) => `${target}:${iso}`
const parseName = (name: string) => {
  const i = name.indexOf(':')
  return { target: name.slice(0, i), iso: name.slice(i + 1) }
}

/** 変化があったものだけバックアップする */
export async function backupNow(reason = 'auto') {
  const iso = new Date().toISOString()
  for (const target of TARGETS) {
    try {
      const value = readDoc<unknown>(target, null)
      // 中身が無いものは残す意味が無い。ここで空を保存すると、
      // 後で「空の世代」に戻してしまう事故のもとにもなる
      if (value === null || value === undefined) continue
      const json = JSON.stringify(value)
      if (!json || json === '{}' || json === '[]') continue

      const h = hashOf(value)
      if (lastHash.get(target) === h) continue // 変わっていないので書かない

      await putBackup(nameOf(target, iso), { savedAt: iso, reason, hash: h, value })
      lastHash.set(target, h)
      console.log(`[Backup] ${target} を保存しました (${Math.round(json.length / 1024)}KB, ${reason})`)
    } catch (e) {
      console.error(`[Backup] ${target} の保存に失敗:`, e)
    }
  }
  await prune().catch((e) => console.error('[Backup] 整理に失敗:', e))
}

/** 古い世代を間引く。直近はそのまま、古いものは1日1本だけ残す */
async function prune() {
  const names = await listBackups()
  const byTarget = new Map<string, string[]>()
  names.forEach((n) => {
    const { target } = parseName(n)
    if (!byTarget.has(target)) byTarget.set(target, [])
    byTarget.get(target)!.push(n)
  })

  const now = Date.now()
  for (const [, list] of byTarget) {
    // 新しい順
    list.sort((a, b) => (parseName(a).iso < parseName(b).iso ? 1 : -1))
    const keep = new Set<string>(list.slice(0, KEEP_RECENT))
    const seenDay = new Set<string>()
    for (const n of list) {
      const { iso } = parseName(n)
      const t = Date.parse(iso)
      if (!Number.isFinite(t)) continue
      const ageDays = (now - t) / 86400000
      if (ageDays > KEEP_DAILY_DAYS) continue // 古すぎるものは残さない
      const day = iso.slice(0, 10)
      if (!seenDay.has(day)) {
        seenDay.add(day)
        keep.add(n) // その日の最新を1本だけ残す
      }
    }
    for (const n of list) {
      if (keep.has(n)) continue
      await deleteBackup(n).catch(() => undefined)
    }
  }
}

export async function getBackupList() {
  const names = await listBackups()
  const items = names.map((n) => {
    const { target, iso } = parseName(n)
    return { name: n, target, savedAt: iso }
  })
  items.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
  return items
}

/** 指定した世代の中身を返す（中身を確認してから戻せるように） */
export async function readBackup(name: string) {
  return getBackup(name)
}

/**
 * 指定した世代に戻す。戻す前に「今の状態」も必ずバックアップしてから行う
 * （戻した結果が意図と違ったときに、やり直せるようにするため）。
 */
export async function restoreBackup(name: string): Promise<{ ok: boolean; reason?: string }> {
  const { target } = parseName(name)
  if (!TARGETS.includes(target as Target)) return { ok: false, reason: 'unknown-target' }
  const snap = (await getBackup(name)) as { value?: unknown } | null
  if (!snap || snap.value === undefined) return { ok: false, reason: 'not-found' }

  await backupNow('restore前の保存')
  writeDoc(target, snap.value)
  // 次回の自動バックアップで「変化なし」と誤判定されないように覚え直す
  lastHash.set(target as Target, hashOf(snap.value))
  console.log(`[Backup] ${name} に戻しました`)
  return { ok: true }
}

export function startBackups() {
  // 起動直後の状態を1本残す（デプロイ前の状態に戻せるようにする）
  backupNow('起動時').catch((e) => console.error('[Backup] 失敗:', e))
  const timer = setInterval(() => {
    backupNow('auto').catch((e) => console.error('[Backup] 失敗:', e))
  }, CHECK_INTERVAL_MS)
  timer.unref?.()
}
