import { createSlice, PayloadAction } from '@reduxjs/toolkit'

// 伝言板（昭和の駅の伝言板風）の1件
export interface BoardMessage {
  id: string
  name: string
  content: string
  createdAt: number
}

interface BoardState {
  dialogOpen: boolean
  messages: BoardMessage[] // 古い順（配列末尾＝最新＝右端に表示）
}

const initialState: BoardState = {
  dialogOpen: false,
  messages: [],
}

const boardSlice = createSlice({
  name: 'board',
  initialState,
  reducers: {
    openBoardDialog: (state) => { state.dialogOpen = true },
    closeBoardDialog: (state) => { state.dialogOpen = false },
    // 入室時などに全件で置き換える
    setBoardMessages: (state, action: PayloadAction<BoardMessage[]>) => {
      state.messages = [...action.payload].sort((a, b) => a.createdAt - b.createdAt)
    },
    // 新しい書き込みを末尾（＝右端）に足す
    addBoardMessage: (state, action: PayloadAction<BoardMessage>) => {
      if (state.messages.some((m) => m.id === action.payload.id)) return
      state.messages.push(action.payload)
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
