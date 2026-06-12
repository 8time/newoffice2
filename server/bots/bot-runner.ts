import { Client, Room } from 'colyseus.js'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

import { CollisionGrid, loadCollisionGrid } from './pathfinding'
import { KeibaData, KEIBA_ROOT } from './keiba-data'
import { GeminiClient } from './gemini-client'
import { OllamaClient } from './ollama-client'
import { AgentBrain, LLMClient } from './agent-brain'
import { DebateManager } from './debate-manager'
import { TickScheduler } from './tick-scheduler'
import { buildRoster } from './agent-personalities'
import { fetchRaceData, summarizeResearch, extractRaceId } from './research-tools'
import { KnowledgeStore } from './knowledge-store'
import {
  Msg, Perception, AgentAction, PersonalityTemplate, RaceSummary,
  PROXIMITY_RANGE, CHAT_MIN_INTERVAL_MS, SIGNBOARD_COOLDOWN_MS,
  DEBATE_TURN_DELAY_MS, SPAWN,
} from './types'

// ── 共有ミッション状態（全エージェントが参照） ──
interface MissionState {
  mission: string
  raceId: string | null
  dataReady: boolean
  raceSummary: string
}

if (process.platform === 'win32') {
  try { execSync('chcp 65001', { stdio: 'ignore' }) } catch {}
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const randInt = (a: number, b: number) => Math.floor(Math.random() * (b - a + 1)) + a

// ── Autonomous Agent ─────────────────────────────────────────────────
class AutonomousAgent {
  room!: Room
  brain: AgentBrain
  personality: PersonalityTemplate
  x: number
  y: number
  mySessionId = ''
  private grid: CollisionGrid
  private otherPlayers = new Map<string, { x: number; y: number; name: string }>()
  private allBotSessionIds: Set<string>
  private allBotNames: Set<string>
  private debateManager: DebateManager
  private knowledge: KnowledgeStore
  private missionState: MissionState
  private recentMessages: Array<{ author: string; content: string; timestamp: number }> = []

  constructor(
    brain: AgentBrain, grid: CollisionGrid,
    allBotSessionIds: Set<string>, allBotNames: Set<string>,
    debateManager: DebateManager, knowledge: KnowledgeStore, missionState: MissionState,
  ) {
    this.brain = brain
    this.personality = brain.personality
    this.x = SPAWN.x + randInt(-50, 50)
    this.y = SPAWN.y + randInt(-30, 30)
    this.grid = grid
    this.allBotSessionIds = allBotSessionIds
    this.allBotNames = allBotNames
    this.debateManager = debateManager
    this.knowledge = knowledge
    this.missionState = missionState
  }

  async connect(serverUrl: string) {
    const client = new Client(serverUrl)
    this.room = await client.joinOrCreate('skyoffice', { password: null })
    this.mySessionId = this.room.sessionId
    this.allBotSessionIds.add(this.mySessionId)

    this.room.send(Msg.UPDATE_PLAYER_NAME, { name: this.personality.name })
    this.room.send(Msg.UPDATE_PLAYER, {
      x: this.x, y: this.y,
      anim: `${this.personality.texture}_idle_down`,
    })

    this.room.state.players.onAdd = (player: any, sessionId: string) => {
      if (sessionId === this.mySessionId) return
      this.otherPlayers.set(sessionId, { x: player.x, y: player.y, name: player.name || '' })
      player.onChange = (changes: any[]) => {
        const entry = this.otherPlayers.get(sessionId)
        if (!entry) return
        for (const c of changes) {
          if (c.field === 'x') entry.x = c.value
          else if (c.field === 'y') entry.y = c.value
          else if (c.field === 'name') entry.name = c.value
        }
      }
    }
    this.room.state.players.onRemove = (_: any, sessionId: string) => {
      this.otherPlayers.delete(sessionId)
    }

    this.room.onMessage(Msg.ADD_CHAT_MESSAGE, (data: any) => {
      if (data.content) {
        this.recentMessages.push({ author: data.clientId || '?', content: data.content, timestamp: Date.now() })
        if (this.recentMessages.length > 20) this.recentMessages.shift()
      }
    })

    console.log(`[${this.personality.name}] connected (${this.mySessionId})`)
  }

  buildPerception(raceData: RaceSummary | null, tick: number): Perception {
    const nearby = Array.from(this.otherPlayers.entries())
      .map(([sid, p]) => {
        const dx = p.x - this.x, dy = p.y - this.y
        return {
          sessionId: sid, name: p.name, x: p.x, y: p.y,
          distance: Math.sqrt(dx * dx + dy * dy),
          isBot: this.allBotSessionIds.has(sid) || this.allBotNames.has(p.name),
        }
      })
      .filter(p => p.distance < PROXIMITY_RANGE * 2)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 8)

    return {
      self: { x: this.x, y: this.y, name: this.personality.name, sessionId: this.mySessionId },
      nearbyPlayers: nearby,
      recentChatMessages: this.recentMessages.slice(-10),
      activeDebate: this.debateManager.getActiveFor(this.personality.name),
      currentRaceData: raceData,
      tickNumber: tick,
      mission: this.missionState.mission,
      missionRaceId: this.missionState.raceId,
      dataReady: this.missionState.dataReady,
      raceSummary: this.missionState.raceSummary,
    }
  }

  async executeAction(action: AgentAction) {
    switch (action.type) {
      case 'idle':
        break

      case 'wander':
        console.log(`[${this.personality.name}] -> ${action.target.label} (${action.target.x},${action.target.y})`)
        await this.moveTo(action.target.x, action.target.y)
        break

      case 'chat':
        if (Date.now() - this.brain.lastChatTime > CHAT_MIN_INTERVAL_MS) {
          this.room.send(Msg.ADD_CHAT_MESSAGE, { content: action.message })
          this.brain.lastChatTime = Date.now()
          console.log(`[${this.personality.name}] "${action.message}"`)
        }
        break

      case 'approach': {
        const target = this.otherPlayers.get(action.targetSessionId)
        if (target) await this.moveTo(target.x + randInt(-30, 30), target.y + randInt(-30, 30))
        break
      }

      case 'debate_initiate': {
        const id = this.debateManager.initiate(
          this.personality.name, action.targetAgent, action.topic, action.opener,
        )
        if (id) {
          this.room.send(Msg.ADD_CHAT_MESSAGE, { content: `[${action.targetAgent}へ] ${action.opener}` })
          this.brain.lastChatTime = Date.now()
          console.log(`[${this.personality.name}] debate START → ${action.targetAgent}: "${action.opener}"`)
        } else {
          console.log(`[${this.personality.name}] debate BLOCKED (cooldown or busy)`)
        }
        break
      }

      case 'debate_reply': {
        // addReply が false = 自分の番ではない（既に返答済み）→ 二重送信を防ぐ
        const accepted = this.debateManager.addReply(action.debateId, this.personality.name, action.message)
        if (!accepted) break
        this.room.send(Msg.ADD_CHAT_MESSAGE, { content: action.message })
        this.brain.lastChatTime = Date.now()
        console.log(`[${this.personality.name}] debate reply: "${action.message}"`)
        break
      }

      case 'post_signboard':
        if (Date.now() - this.brain.lastSignboardTime > SIGNBOARD_COOLDOWN_MS) {
          this.room.send(Msg.ADD_SIGNBOARD, { x: this.x, y: this.y - 30, text: action.text, image: '', url: '' })
          this.brain.lastSignboardTime = Date.now()
          console.log(`[${this.personality.name}] signboard: "${action.text.slice(0, 40)}..."`)
        }
        break

      case 'update_prediction':
        console.log(`[${this.personality.name}] prediction: "${action.prediction.slice(0, 50)}..."`)
        break

      case 'fetch_data': {
        // デスクA: Pythonツールでレースデータ取得 → 共有DBへ書き込み
        console.log(`[${this.personality.name}] 🔍 調査開始: ${action.raceId}`)
        this.room.send(Msg.ADD_CHAT_MESSAGE, { content: `${action.raceId}を調査中...` })
        const research = await fetchRaceData(action.raceId)
        if (research.error || !research.horses.length) {
          console.log(`[${this.personality.name}] 調査失敗: ${research.error}`)
          this.room.send(Msg.ADD_CHAT_MESSAGE, { content: `調査失敗: ${(research.error || '').slice(0, 40)}` })
          this.missionState.dataReady = false
        } else {
          const summary = summarizeResearch(research)
          this.knowledge.storeRaceData(research)
          this.knowledge.store(this.personality.name, action.raceId, summary)
          this.missionState.raceSummary = summary
          this.missionState.dataReady = true
          console.log(`[${this.personality.name}] ✅ 調査完了 → 共有DB: ${summary}`)
          this.room.send(Msg.ADD_CHAT_MESSAGE, { content: `### 保存：[${action.raceId}] ${summary.slice(0, 50)}` })
          this.brain.lastChatTime = Date.now()
        }
        break
      }

      case 'report': {
        // デスクB/C: 結論・数値をチャット報告 + 共有DBへ保存
        this.room.send(Msg.ADD_CHAT_MESSAGE, { content: action.message.slice(0, 70) })
        this.brain.lastChatTime = Date.now()
        if (action.knowledge) {
          this.knowledge.store(this.personality.name, action.knowledge.topic, action.knowledge.content)
        }
        console.log(`[${this.personality.name}] 📋 報告: "${action.message}"`)
        break
      }
    }
  }

  async moveTo(tx: number, ty: number) {
    const waypoints = this.grid.findPath(this.x, this.y, tx, ty)
    if (!waypoints || waypoints.length < 2) {
      console.log(`[${this.personality.name}] pathfind failed from (${Math.round(this.x)},${Math.round(this.y)}) to (${tx},${ty})`)
      return
    }

    for (let w = 1; w < waypoints.length; w++) {
      const wp = waypoints[w]
      const segDx = wp.x - this.x, segDy = wp.y - this.y
      const segLen = Math.sqrt(segDx * segDx + segDy * segDy)
      const steps = Math.max(1, Math.round(segLen / 3))
      const sx = segDx / steps, sy = segDy / steps
      const dir = Math.abs(segDx) > Math.abs(segDy) ? (segDx > 0 ? 'right' : 'left') : (segDy > 0 ? 'down' : 'up')

      for (let i = 0; i < steps; i++) {
        this.x += sx; this.y += sy
        this.room.send(Msg.UPDATE_PLAYER, {
          x: Math.round(this.x), y: Math.round(this.y),
          anim: `${this.personality.texture}_run_${dir}`,
        })
        await sleep(50)
      }
    }

    this.x = tx; this.y = ty
    this.room.send(Msg.UPDATE_PLAYER, {
      x: Math.round(this.x), y: Math.round(this.y),
      anim: `${this.personality.texture}_idle_down`,
    })
  }
}

// ── State sync for prediction board API ──────────────────────────────
function syncState(agents: AutonomousAgent[], debateManager: DebateManager, gemini: LLMClient, mission: string) {
  const predictions = agents.map(a => ({
    name: a.personality.name,
    role: a.personality.role,
    desk: a.personality.desk,
    prediction: a.brain.currentPrediction || '分析中...',
  }))
  const debates = debateManager.getRecentSummaries(5)
  const active = predictions.filter(p => p.prediction !== '分析中...').length
  const consensus = active > 0
    ? `${agents.length}体中${active}体が予想を出しました`
    : 'AIエージェントが分析を開始しています...'

  const stats = gemini.getStats()
  const state = { predictions, debates, consensus, mission, stats, updatedAt: Date.now() }
  fs.writeFileSync(path.join(__dirname, 'agent-state.json'), JSON.stringify(state, null, 2), 'utf-8')
}

// ── Build race summary ───────────────────────────────────────────────
function buildRaceSummary(data: KeibaData): RaceSummary | null {
  if (!data.races.length) return null
  const latest = data.races[data.races.length - 1]
  return {
    raceId: latest.RaceID,
    topHorses: latest.Results.slice(0, 8).map(r => ({
      umaban: r.馬番,
      name: data.clean(r['馬名(ラベル付)']),
      blood: r.血統 || '',
      uIndex: r.U指数,
      omegaIndex: r.オメガ指数,
      popularity: r.人気,
      training: r.調教,
    })),
    jockeyTip: data.jockeyTip(),
  }
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  // --ollama フラグを別途解析 (process.argv[2] がURLとして誤認されないよう)
  const args = process.argv.slice(2)
  const useOllama = args.includes('--ollama')
  const serverUrl = args.find(a => a.startsWith('ws://') || a.startsWith('wss://')) || 'ws://localhost:2567'
  const agentCount = parseInt(args.find(a => /^\d+$/.test(a)) || '3', 10)

  console.log('=== AUTOMATA Keiba AI Agents ===')
  console.log(`Server: ${serverUrl}`)
  console.log(`Agents: ${agentCount}`)
  console.log(`LLM: ${useOllama ? 'Ollama (local)' : 'Gemini API'}\n`)

  const keibaData = new KeibaData()
  keibaData.load()
  const grid = loadCollisionGrid()

  let llm: LLMClient
  if (useOllama) {
    console.log(`[Ollama] Using local model: ${process.env.OLLAMA_MODEL || 'gemma3:12b'}\n`)
    llm = new OllamaClient()
  } else {
    // Load Gemini API key
    let apiKey = process.env.GEMINI_API_KEY || ''
    if (!apiKey) {
      const envPath = path.join(KEIBA_ROOT, '.env')
      if (fs.existsSync(envPath)) {
        const match = fs.readFileSync(envPath, 'utf-8').match(/GEMINI_API_KEY="?([^"\n\r]+)"?/)
        if (match) apiKey = match[1].trim()
      }
    }
    if (!apiKey) { console.error('GEMINI_API_KEY not found'); process.exit(1) }
    console.log('[Gemini] API key loaded\n')
    llm = new GeminiClient(apiKey)
  }

  const gemini = llm
  const debateManager = new DebateManager()
  const knowledge = new KnowledgeStore(__dirname)
  const missionState: MissionState = { mission: '', raceId: null, dataReady: false, raceSummary: '' }
  const roster = buildRoster(agentCount)

  const allBotSessionIds = new Set<string>()
  const allBotNames = new Set(roster.map(p => p.name))
  const agents: AutonomousAgent[] = []

  for (const personality of roster) {
    const brain = new AgentBrain(personality, gemini, keibaData)
    const agent = new AutonomousAgent(brain, grid, allBotSessionIds, allBotNames, debateManager, knowledge, missionState)
    try {
      await agent.connect(serverUrl)
      agents.push(agent)
      await sleep(800)
    } catch (err: any) {
      console.error(`[${personality.name}] connection failed: ${err.message}`)
    }
  }

  console.log(`\n${agents.length} AUTOMATA agents active.\n`)

  const raceData = buildRaceSummary(keibaData)

  // Greeting
  await sleep(2000)
  for (const agent of agents) {
    agent.room.send(Msg.ADD_CHAT_MESSAGE, {
      content: `${agent.personality.name}です。${agent.personality.catchphrase}`,
    })
    await sleep(1500)
  }

  // ミッション（課題）の定期読み込み
  const missionFile = path.join(__dirname, 'mission.json')
  let lastMissionAt = 0
  function loadMission() {
    try {
      if (fs.existsSync(missionFile)) {
        const data = JSON.parse(fs.readFileSync(missionFile, 'utf-8'))
        if (data.mission && data.setAt !== lastMissionAt) {
          lastMissionAt = data.setAt
          // 共有ミッション状態を更新（レースID抽出、データ未取得にリセット）
          missionState.mission = data.mission
          missionState.raceId = extractRaceId(data.mission)
          missionState.dataReady = false
          missionState.raceSummary = ''
          console.log(`[Mission] 新課題: "${data.mission}" (raceId=${missionState.raceId || 'なし'})`)
          for (const agent of agents) {
            agent.room.send(Msg.ADD_CHAT_MESSAGE, { content: `了解。「${data.mission}」を分析します` })
          }
        }
      }
    } catch {}
  }
  setInterval(loadMission, 5000)

  // Start autonomous tick loop
  let globalTick = 0
  const scheduler = new TickScheduler()
  scheduler.start(agents.length, async (i) => {
    const agent = agents[i]
    globalTick++
    // 討論ターン中はサブループに任せる（二重処理・二重API消費を防ぐ）
    const myDebate = debateManager.getActiveFor(agent.personality.name)
    if (myDebate?.myTurn) return
    const perception = agent.buildPerception(raceData, globalTick)
    const action = await agent.brain.decide(perception)
    await agent.executeAction(action)
  })

  // 討論サブループ: 5秒ごとに全エージェントの討論返答をチェック
  setInterval(async () => {
    for (const agent of agents) {
      const debate = debateManager.getActiveFor(agent.personality.name)
      if (!debate || !debate.myTurn) continue

      console.log(`[${agent.personality.name}] debate turn → replying to ${debate.partner}`)
      const perception = agent.buildPerception(raceData, globalTick)
      const action = await agent.brain.decide(perception)
      await agent.executeAction(action)
      await sleep(2000)
    }
  }, 5000)

  // Periodic state sync
  setInterval(() => syncState(agents, debateManager, gemini, missionState.mission), 30000)
  syncState(agents, debateManager, gemini, missionState.mission)
}

main().catch(console.error)
