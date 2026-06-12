// ── Message enum (types/Messages.ts の数値と一致させること) ──
export const Msg = {
  UPDATE_PLAYER: 0,
  UPDATE_PLAYER_NAME: 1,
  ADD_CHAT_MESSAGE: 10,
  SEND_ROOM_DATA: 11,
  ADD_SIGNBOARD: 16,
  REMOVE_SIGNBOARD: 17,
  UPDATE_SIGNBOARD: 18,
} as const

// ── Agent action types ──
export type AgentAction =
  | { type: 'idle' }
  | { type: 'wander'; target: { x: number; y: number; label: string } }
  | { type: 'chat'; message: string }
  | { type: 'approach'; targetSessionId: string; targetName: string }
  | { type: 'debate_initiate'; targetAgent: string; topic: string; opener: string }
  | { type: 'debate_reply'; debateId: string; message: string }
  | { type: 'post_signboard'; text: string; x: number; y: number }
  | { type: 'update_prediction'; prediction: string }
  | { type: 'fetch_data'; raceId: string }
  | { type: 'report'; message: string; knowledge?: { topic: string; content: string } }

// ── Perception snapshot ──
export interface Perception {
  self: { x: number; y: number; name: string; sessionId: string }
  nearbyPlayers: Array<{
    sessionId: string; name: string; x: number; y: number
    distance: number; isBot: boolean
  }>
  recentChatMessages: Array<{ author: string; content: string; timestamp: number }>
  activeDebate: ActiveDebate | null
  currentRaceData: RaceSummary | null
  tickNumber: number
  mission: string
  missionRaceId: string | null   // 課題から抽出した12桁レースID
  dataReady: boolean             // デスクAが調査完了したか
  raceSummary: string            // 調査データの短い要約（デスクB/C用）
}

export interface ActiveDebate {
  debateId: string
  topic: string
  partner: string
  exchanges: Array<{ speaker: string; message: string }>
  myTurn: boolean
  exchangeCount: number
}

export interface RaceSummary {
  raceId: string
  topHorses: Array<{
    umaban: number; name: string; blood: string
    uIndex: number; omegaIndex: number; popularity: number
    training: string
  }>
  jockeyTip: { name: string; strengths: string[] } | null
}

// ── Memory ──
export interface MemoryEntry {
  tick: number
  timestamp: number
  type: 'observation' | 'conversation' | 'analysis' | 'prediction' | 'debate'
  content: string
  importance: number
}

// ── Personality ──
export type Desk = 'A' | 'B' | 'C'

export interface PersonalityTemplate {
  name: string
  texture: 'adam' | 'ash' | 'lucy' | 'nancy'
  role: string
  specialty: string
  dataFocus: 'bloodline' | 'data' | 'odds' | 'training' | 'jockey' | 'pace'
  speakingStyle: string
  debateStyle: string
  catchphrase: string
  biases: string[]
  temperature: number
  desk: Desk                                  // A:収集 B:分析 C:討論
  debateRole?: 'conservative' | 'intuitive'   // デスクCのみ: C-1保守/C-2直感
}

// ── Constants ──
export const PROXIMITY_RANGE = 120
export const TICK_INTERVAL_MS = 25000
export const TICK_JITTER_MS = 5000
export const DEBATE_MAX_EXCHANGES = 4
export const DEBATE_COOLDOWN_MS = 120000
export const DEBATE_TURN_DELAY_MS = 5000
export const SIGNBOARD_COOLDOWN_MS = 300000
export const CHAT_MIN_INTERVAL_MS = 8000
export const MAX_MEMORY_ENTRIES = 50
export const GEMINI_STAGGER_MS = 4200

export const AREAS = [
  { x: 800, y: 380, label: 'エントランス' },
  { x: 750, y: 350, label: '通路中央' },
  { x: 850, y: 350, label: '通路右' },
  { x: 700, y: 420, label: '下通路' },
  { x: 800, y: 450, label: '南エリア' },
  { x: 750, y: 300, label: '北通路' },
]

export const SPAWN = { x: 800, y: 380 }
