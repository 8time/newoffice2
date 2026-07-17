import { createSlice, PayloadAction } from '@reduxjs/toolkit'

/**
 * スタンプの台帳。サーバーから配られたものをそのまま持つ（全員で共有）。
 * 画像そのものは /files/... にあり、ここにはURLだけを持つ。
 */
export interface Stamp {
  name: string
  category: string
  url: string
  type: string
  author: string      // 登録者のclientId。消せるかの判定に使う
  authorName: string
  useCount: number
  createdAt: number
}

export const STAMP_CATEGORIES = ['挨拶', '仕事', '感情', 'その他'] as const

interface StampState {
  stamps: Record<string, Stamp>
  managerOpen: boolean
}

const initialState: StampState = {
  stamps: {},
  managerOpen: false,
}

export const stampSlice = createSlice({
  name: 'stamp',
  initialState,
  reducers: {
    // サーバーが配る一覧で丸ごと置き換える（台帳の持ち主はサーバー）
    setStamps: (state, action: PayloadAction<Record<string, Stamp>>) => {
      state.stamps = action.payload || {}
    },
    openStampManager: (state) => {
      state.managerOpen = true
    },
    closeStampManager: (state) => {
      state.managerOpen = false
    },
  },
})

export const { setStamps, openStampManager, closeStampManager } = stampSlice.actions
export default stampSlice.reducer
