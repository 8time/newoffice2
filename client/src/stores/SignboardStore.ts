import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface SignboardData {
  id: string
  text: string
  url: string
  image: string
  bgColor: string
  textColor: string
  scale: number
}

interface SignboardState {
  signboardDialogOpen: boolean
  isPlacing: boolean
  deleteConfirm: { id: string; x: number; y: number } | null
  editBoard: SignboardData | null
}

const initialState: SignboardState = {
  signboardDialogOpen: false,
  isPlacing: false,
  deleteConfirm: null,
  editBoard: null,
}

export const signboardSlice = createSlice({
  name: 'signboard',
  initialState,
  reducers: {
    openSignboardDialog: (state) => {
      state.signboardDialogOpen = true
    },
    closeSignboardDialog: (state) => {
      state.signboardDialogOpen = false
    },
    setSignboardPlacing: (state, action: PayloadAction<boolean>) => {
      state.isPlacing = action.payload
    },
    requestDeleteSignboard: (state, action: PayloadAction<{ id: string; x: number; y: number }>) => {
      state.deleteConfirm = action.payload
    },
    clearDeleteConfirm: (state) => {
      state.deleteConfirm = null
    },
    openEditSignboard: (state, action: PayloadAction<SignboardData>) => {
      state.editBoard = action.payload
    },
    closeEditSignboard: (state) => {
      state.editBoard = null
    },
  },
})

export const {
  openSignboardDialog,
  closeSignboardDialog,
  setSignboardPlacing,
  requestDeleteSignboard,
  clearDeleteConfirm,
  openEditSignboard,
  closeEditSignboard,
} = signboardSlice.actions

export default signboardSlice.reducer
