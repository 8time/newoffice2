import { DEBATE_MAX_EXCHANGES, DEBATE_COOLDOWN_MS, ActiveDebate } from './types'

interface Debate {
  id: string
  agentA: string
  agentB: string
  topic: string
  exchanges: Array<{ speaker: string; message: string }>
  currentTurn: string
  startedAt: number
  lastExchangeAt: number
  completed: boolean
}

export class DebateManager {
  private debates = new Map<string, Debate>()
  private cooldowns = new Map<string, number>()
  private counter = 0

  canInitiate(agentName: string, targetName: string): boolean {
    const now = Date.now()
    if (now - (this.cooldowns.get(agentName) || 0) < DEBATE_COOLDOWN_MS) return false
    if (now - (this.cooldowns.get(targetName) || 0) < DEBATE_COOLDOWN_MS) return false

    for (const d of this.debates.values()) {
      if (d.completed) continue
      if (d.agentA === agentName || d.agentB === agentName) return false
      if (d.agentA === targetName || d.agentB === targetName) return false
    }
    return true
  }

  initiate(agentA: string, agentB: string, topic: string, opener: string): string | null {
    if (!this.canInitiate(agentA, agentB)) return null
    const id = `debate_${++this.counter}`
    this.debates.set(id, {
      id, agentA, agentB, topic,
      exchanges: [{ speaker: agentA, message: opener }],
      currentTurn: agentB,
      startedAt: Date.now(),
      lastExchangeAt: Date.now(),
      completed: false,
    })
    return id
  }

  addReply(debateId: string, speaker: string, message: string): boolean {
    const d = this.debates.get(debateId)
    if (!d || d.completed || d.currentTurn !== speaker) return false

    d.exchanges.push({ speaker, message })
    d.lastExchangeAt = Date.now()

    if (d.exchanges.length >= DEBATE_MAX_EXCHANGES) {
      this.endDebate(debateId)
      return true
    }

    d.currentTurn = d.currentTurn === d.agentA ? d.agentB : d.agentA
    return true
  }

  getActiveFor(agentName: string): ActiveDebate | null {
    for (const d of this.debates.values()) {
      if (d.completed) continue
      if (d.agentA !== agentName && d.agentB !== agentName) continue

      // 30秒タイムアウト
      if (Date.now() - d.lastExchangeAt > 30000) {
        this.endDebate(d.id)
        continue
      }

      return {
        debateId: d.id,
        topic: d.topic,
        partner: d.agentA === agentName ? d.agentB : d.agentA,
        exchanges: d.exchanges,
        myTurn: d.currentTurn === agentName,
        exchangeCount: d.exchanges.length,
      }
    }
    return null
  }

  private endDebate(id: string) {
    const d = this.debates.get(id)
    if (!d) return
    d.completed = true
    const now = Date.now()
    this.cooldowns.set(d.agentA, now)
    this.cooldowns.set(d.agentB, now)
  }

  getRecentSummaries(limit = 5) {
    return Array.from(this.debates.values())
      .filter(d => d.completed && d.exchanges.length >= 2)
      .sort((a, b) => b.lastExchangeAt - a.lastExchangeAt)
      .slice(0, limit)
      .map(d => ({ agentA: d.agentA, agentB: d.agentB, topic: d.topic, exchanges: d.exchanges }))
  }
}
