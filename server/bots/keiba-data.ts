import fs from 'fs'
import path from 'path'

export interface RaceResult {
  馬番: number; '馬名(ラベル付)': string; 人気: number; 馬体重: string
  調教: string; U指数: number; オメガ指数: number; 血統: string
  '加点内訳(備考)': string; 新順位: number
}
export interface RaceHistory { RaceID: string; SavedAt: string; Results: RaceResult[] }
export interface JockeyTendency { name: string; add_100: string[]; add_90: string[]; sub_60: string[]; sub_70: string[] }

const KEIBA_ROOT = process.env.KEIBA_ROOT
  || path.join(process.env.USERPROFILE || process.env.HOME || '', '.gemini', 'antigravity', 'scratch', 'keiba_analysis')
const DATA_DIR = path.join(KEIBA_ROOT, 'data')

export { KEIBA_ROOT }

export class KeibaData {
  races: RaceHistory[] = []
  jockeys: Record<string, JockeyTendency> = {}
  weights: Record<string, number> = {}

  load() {
    const histDir = path.join(DATA_DIR, 'history')
    if (fs.existsSync(histDir)) {
      for (const f of fs.readdirSync(histDir).filter(f => f.endsWith('.json'))) {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(histDir, f), 'utf-8'))
          if (d.RaceID && d.Results) this.races.push(d)
        } catch {}
      }
    }
    const jp = path.join(DATA_DIR, 'jockey_tendency_db.json')
    if (fs.existsSync(jp)) this.jockeys = JSON.parse(fs.readFileSync(jp, 'utf-8'))
    const wp = path.join(KEIBA_ROOT, '.score_weights_jockey.json')
    if (fs.existsSync(wp)) this.weights = JSON.parse(fs.readFileSync(wp, 'utf-8'))
    console.log(`[Data] races:${this.races.length} jockeys:${Object.keys(this.jockeys).length}`)
  }

  clean(s: string) { return s.replace(/[💪🧬⚡🔥🎯]/g, '').trim() }

  randomHorse() {
    if (!this.races.length) return null
    const race = this.races[Math.floor(Math.random() * this.races.length)]
    const r = race.Results[Math.floor(Math.random() * Math.min(race.Results.length, 8))]
    return r ? { name: this.clean(r['馬名(ラベル付)']), umaban: r.馬番, blood: r.血統 || '', u: r.U指数, omega: r.オメガ指数, training: r.調教 } : null
  }

  topPick() {
    if (!this.races.length) return null
    const r = this.races[this.races.length - 1].Results[0]
    return r ? { name: this.clean(r['馬名(ラベル付)']), umaban: r.馬番, blood: r.血統 || '', u: r.U指数, omega: r.オメガ指数 } : null
  }

  longshots() {
    if (!this.races.length) return []
    return this.races[this.races.length - 1].Results
      .filter(r => r.人気 >= 5).slice(0, 3)
      .map(r => ({ name: this.clean(r['馬名(ラベル付)']), umaban: r.馬番, pop: r.人気, u: r.U指数 }))
  }

  jockeyTip() {
    const entries = Object.values(this.jockeys)
    if (!entries.length) return null
    const j = entries[Math.floor(Math.random() * entries.length)]
    return { name: j.name, strengths: (j.add_100 || []).slice(0, 3) }
  }
}
