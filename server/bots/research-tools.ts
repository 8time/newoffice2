import { spawn } from 'child_process'
import path from 'path'
import { KEIBA_ROOT } from './keiba-data'

export interface RaceHorse {
  name?: string
  Umaban?: number
  Odds?: number
  Popularity?: number
  OguraIndex?: number
  BattleScore?: number
  NIndex?: number
  Jockey?: string
  Trainer?: string
}

export interface RaceResearch {
  raceId: string
  horses: RaceHorse[]
  pace: Record<string, any> | null
  meta: Record<string, any>
  error?: string
}

const MARKER = '@@@AGENT_JSON@@@'
const PYTHON = process.env.PYTHON_BIN || 'python'

/**
 * keiba_analysis の調査ツールをサブプロセス実行してレースデータを取得。
 * デスクA（データ収集班）が使う。
 */
export function fetchRaceData(raceId: string, timeoutMs = 90000): Promise<RaceResearch> {
  return new Promise((resolve) => {
    const scriptPath = path.join(KEIBA_ROOT, 'scripts', 'agent_race_tool.py')
    const proc = spawn(PYTHON, [scriptPath, raceId], {
      cwd: KEIBA_ROOT,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      proc.kill()
      resolve({ raceId, horses: [], pace: null, meta: {}, error: 'timeout' })
    }, timeoutMs)

    proc.stdout.on('data', (d) => (stdout += d.toString()))
    proc.stderr.on('data', (d) => (stderr += d.toString()))

    proc.on('close', () => {
      clearTimeout(timer)
      // マーカー以降のJSONを抽出
      const idx = stdout.lastIndexOf(MARKER)
      if (idx === -1) {
        resolve({ raceId, horses: [], pace: null, meta: {}, error: `no JSON output. stderr: ${stderr.slice(-200)}` })
        return
      }
      const jsonStr = stdout.slice(idx + MARKER.length).trim().split('\n')[0]
      try {
        const parsed = JSON.parse(jsonStr)
        resolve(parsed)
      } catch (e) {
        resolve({ raceId, horses: [], pace: null, meta: {}, error: `parse failed: ${(e as Error).message}` })
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      resolve({ raceId, horses: [], pace: null, meta: {}, error: `spawn failed: ${err.message}` })
    })
  })
}

/** レース文字列から12桁のレースIDを抽出 */
export function extractRaceId(text: string): string | null {
  const m = text.match(/(\d{12})/)
  return m ? m[1] : null
}

/** 研究データを短い要約テキストに変換（プロンプト/チャット用） */
export function summarizeResearch(r: RaceResearch): string {
  if (r.error || !r.horses.length) return `データ取得失敗(${r.raceId})`
  const meta = r.meta || {}
  const head = `${meta.RaceName || r.raceId} ${meta.CurrentDistance || ''}${meta.CurrentSurface || ''}`
  // BattleScore上位3頭
  const top = [...r.horses]
    .filter(h => typeof h.BattleScore === 'number')
    .sort((a, b) => (b.BattleScore || 0) - (a.BattleScore || 0))
    .slice(0, 3)
    .map(h => `${h.Umaban}番${h.name}(戦${h.BattleScore} U${h.OguraIndex} N${h.NIndex} ${h.Popularity}人気)`)
    .join(' / ')
  const pace = r.pace?.pace_label ? `ペース:${r.pace.pace_label}` : ''
  return `${head} | 上位: ${top} | ${pace}`
}
