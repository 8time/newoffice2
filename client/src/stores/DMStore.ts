import { createSlice, PayloadAction } from '@reduxjs/toolkit'

import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'

export interface DMMessage {
  id: string
  fromUserKey: string
  toUserKey: string
  fromName: string
  content: string
  createdAt: number
}

const LAST_READ_KEY = 'skyoffice_dm_lastread'

function loadLastRead(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(LAST_READ_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveLastRead(map: Record<string, number>) {
  try { localStorage.setItem(LAST_READ_KEY, JSON.stringify(map)) } catch {}
}

interface DMState {
  // 相手のuserKey → メッセージ一覧
  messagesByKey: Record<string, DMMessage[]>
  // 相手のuserKey → 表示名（最後に分かった名前）
  namesByKey: Record<string, string>
  // いま開いているDMの相手userKey（null=閉じている）
  openKey: string | null
  // 相手のuserKey → 最後に開いて読んだ時刻（localStorage永続。未読判定に使う）
  lastReadByKey: Record<string, number>
}

const initialState: DMState = {
  messagesByKey: {},
  namesByKey: {},
  openKey: null,
  lastReadByKey: loadLastRead(),
}

export const dmSlice = createSlice({
  name: 'dm',
  initialState,
  reducers: {
    // DM受信（自分が送った分のエコーも含む）
    addDmMessage: (state, action: PayloadAction<{ myUserKey: string; msg: DMMessage }>) => {
      const { myUserKey, msg } = action.payload
      const otherKey = msg.fromUserKey === myUserKey ? msg.toUserKey : msg.fromUserKey
      const list = state.messagesByKey[otherKey] || []
      if (list.some((m) => m.id === msg.id)) return // 重複防止
      list.push(msg)
      list.sort((a, b) => a.createdAt - b.createdAt)
      state.messagesByKey[otherKey] = list
      if (msg.fromUserKey !== myUserKey) state.namesByKey[otherKey] = msg.fromName
      // 開いている相手なら即既読にする
      if (state.openKey === otherKey) {
        state.lastReadByKey[otherKey] = Date.now()
        saveLastRead(state.lastReadByKey)
      }
    },
    setDmHistory: (state, action: PayloadAction<{ otherKey: string; messages: DMMessage[] }>) => {
      const { otherKey, messages } = action.payload
      const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt)
      state.messagesByKey[otherKey] = sorted
    },
    // 相手の表示名を記録（オンライン一覧から）
    setDmName: (state, action: PayloadAction<{ userKey: string; name: string }>) => {
      state.namesByKey[action.payload.userKey] = action.payload.name
    },
    openDm: (state, action: PayloadAction<string>) => {
      state.openKey = action.payload
      state.lastReadByKey[action.payload] = Date.now()
      saveLastRead(state.lastReadByKey)
      const game = phaserGame.scene.keys.game as Game
      game?.disableKeys()
    },
    closeDm: (state) => {
      // 閉じる時にも既読時刻を更新しておく
      if (state.openKey) {
        state.lastReadByKey[state.openKey] = Date.now()
        saveLastRead(state.lastReadByKey)
      }
      state.openKey = null
      const game = phaserGame.scene.keys.game as Game
      game?.enableKeys()
    },
  },
})

export const { addDmMessage, setDmHistory, setDmName, openDm, closeDm } = dmSlice.actions

export default dmSlice.reducer
