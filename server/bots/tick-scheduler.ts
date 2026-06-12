import { TICK_INTERVAL_MS, TICK_JITTER_MS } from './types'

type TickCallback = (agentIndex: number) => Promise<void>

export class TickScheduler {
  private timers: NodeJS.Timeout[] = []
  private running = false

  start(agentCount: number, callback: TickCallback) {
    this.running = true
    const stagger = Math.max(TICK_INTERVAL_MS / agentCount, 1000)

    for (let i = 0; i < agentCount; i++) {
      const initialDelay = i * stagger + Math.random() * TICK_JITTER_MS
      this.scheduleAgent(i, initialDelay, callback)
    }

    console.log(`[Scheduler] ${agentCount} agents, stagger=${Math.round(stagger)}ms, tick=${TICK_INTERVAL_MS}ms`)
  }

  private scheduleAgent(index: number, delay: number, callback: TickCallback) {
    const timer = setTimeout(async () => {
      if (!this.running) return
      try {
        await callback(index)
      } catch (err) {
        console.error(`[Scheduler] Agent ${index} error:`, (err as Error).message)
      }
      const next = TICK_INTERVAL_MS + (Math.random() - 0.5) * TICK_JITTER_MS * 2
      this.scheduleAgent(index, next, callback)
    }, delay)
    this.timers.push(timer)
  }

  stop() {
    this.running = false
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
  }
}
