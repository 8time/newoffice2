import fs from 'fs'
import path from 'path'
import { RaceResearch } from './research-tools'

export interface KnowledgeEntry {
  id: string
  author: string
  topic: string
  content: string
  url?: string
  timestamp: number
}

/**
 * 軽量JSON知識ストア（共有DB）。
 * - `### 保存：[対象] [内容] (URL: ...)` プレフィックスをチャットから検知して格納
 * - レース調査データもここに保存し、デスクB/Cが参照
 * - キーワード検索でRAG的に過去の文脈を呼び出す
 */
export class KnowledgeStore {
  private entries: KnowledgeEntry[] = []
  private raceData = new Map<string, RaceResearch>()
  private filePath: string
  private counter = 0

  constructor(dir: string) {
    this.filePath = path.join(dir, 'knowledge.json')
    this.load()
  }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
        this.entries = data.entries || []
        if (data.raceData) {
          for (const [k, v] of Object.entries(data.raceData)) this.raceData.set(k, v as RaceResearch)
        }
        this.counter = this.entries.length
      }
    } catch {}
  }

  private save() {
    try {
      const obj = {
        entries: this.entries.slice(-200),
        raceData: Object.fromEntries(this.raceData),
        updatedAt: Date.now(),
      }
      fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2), 'utf-8')
    } catch {}
  }

  /** チャット発言から `### 保存：` を検知して格納。検知したらtrueを返す */
  detectAndStore(author: string, message: string): KnowledgeEntry | null {
    const m = message.match(/###\s*保存[：:]\s*(?:\[([^\]]+)\])?\s*(.+?)(?:\s*\(URL:\s*([^)]+)\))?$/s)
    if (!m) return null
    const entry: KnowledgeEntry = {
      id: `k_${++this.counter}`,
      author,
      topic: (m[1] || '一般').trim(),
      content: (m[2] || '').trim().slice(0, 500),
      url: m[3]?.trim(),
      timestamp: Date.now(),
    }
    this.entries.push(entry)
    this.save()
    return entry
  }

  /** 直接保存（コード側から） */
  store(author: string, topic: string, content: string, url?: string) {
    const entry: KnowledgeEntry = {
      id: `k_${++this.counter}`, author, topic,
      content: content.slice(0, 500), url, timestamp: Date.now(),
    }
    this.entries.push(entry)
    this.save()
    return entry
  }

  /** レース調査データを保存（デスクA→共有DB） */
  storeRaceData(research: RaceResearch) {
    this.raceData.set(research.raceId, research)
    this.save()
  }

  getRaceData(raceId: string): RaceResearch | null {
    return this.raceData.get(raceId) || null
  }

  hasRaceData(raceId: string): boolean {
    const r = this.raceData.get(raceId)
    return !!r && !r.error && r.horses.length > 0
  }

  /** キーワード検索（RAG的に過去文脈を呼び出す） */
  search(query: string, limit = 5): KnowledgeEntry[] {
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0)
    if (!terms.length) return this.entries.slice(-limit)
    const scored = this.entries.map(e => {
      const hay = `${e.topic} ${e.content}`.toLowerCase()
      const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0)
      return { entry: e, score }
    })
    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.timestamp - a.entry.timestamp)
      .slice(0, limit)
      .map(s => s.entry)
  }

  recent(limit = 5): KnowledgeEntry[] {
    return this.entries.slice(-limit)
  }
}
