import { createSlice, PayloadAction } from '@reduxjs/toolkit'

// 伝言板（昭和の駅の伝言板風）の1件
export interface BoardMessage {
  id: string
  name: string
  content: string
  createdAt: number
}

const LS_LAST_SEEN = 'board_last_seen_at'
function loadLastSeen(): number {
  const v = Number(typeof localStorage !== 'undefined' ? localStorage.getItem(LS_LAST_SEEN) : 0)
  return Number.isFinite(v) ? v : 0
}
function persistLastSeen(v: number) {
  try {
    localStorage.setItem(LS_LAST_SEEN, String(v))
  } catch {
    /* localStorage不可でも無視 */
  }
}
function latestAt(messages: BoardMessage[]): number {
  return messages.reduce((mx, m) => (m.createdAt > mx ? m.createdAt : mx), 0)
}

interface BoardState {
  dialogOpen: boolean
  messages: BoardMessage[] // 古い順（配列末尾＝最新＝右端に表示）
  lastSeenAt: number // これより新しい書き込みが「未読」
}

const initialState: BoardState = {
  dialogOpen: false,
  messages: [],
  lastSeenAt: loadLastSeen(),
}

const boardSlice = createSlice({
  name: 'board',
  initialState,
  reducers: {
    openBoardDialog: (state) => {
      state.dialogOpen = true
      // 開いたら今ある伝言はすべて既読にする
      state.lastSeenAt = Math.max(state.lastSeenAt, latestAt(state.messages))
      persistLastSeen(state.lastSeenAt)
    },
    closeBoardDialog: (state) => {
      state.dialogOpen = false
    },
    // 入室時などに全件で置き換える
    setBoardMessages: (state, action: PayloadAction<BoardMessage[]>) => {
      state.messages = [...action.payload].sort((a, b) => a.createdAt - b.createdAt)
      if (state.dialogOpen) {
        state.lastSeenAt = Math.max(state.lastSeenAt, latestAt(state.messages))
        persistLastSeen(state.lastSeenAt)
      }
    },
    // 新しい書き込みを末尾（＝右端）に足す
    addBoardMessage: (state, action: PayloadAction<BoardMessage>) => {
      if (state.messages.some((m) => m.id === action.payload.id)) return
      state.messages.push(action.payload)
      // 開いている最中に届いた分は既読扱い
      if (state.dialogOpen) {
        state.lastSeenAt = Math.max(state.lastSeenAt, action.payload.createdAt)
        persistLastSeen(state.lastSeenAt)
      }
    },
    removeBoardMessage: (state, action: PayloadAction<string>) => {
      state.messages = state.messages.filter((m) => m.id !== action.payload)
    },
  },
})

export const {
  openBoardDialog,
  closeBoardDialog,
  setBoardMessages,
  addBoardMessage,
  removeBoardMessage,
} = boardSlice.actions

export default boardSlice.reducer
