import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface SignboardState {
  signboardDialogOpen: boolean
  deleteConfirm: { id: string; x: number; y: number } | null
}

const initialState: SignboardState = {
  signboardDialogOpen: false,
  deleteConfirm: null,
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
    requestDeleteSignboard: (state, action: PayloadAction<{ id: string; x: number; y: number }>) => {
      state.deleteConfirm = action.payload
    },
    clearDeleteConfirm: (state) => {
      state.deleteConfirm = null
    },
  },
})

export const {
  openSignboardDialog,
  closeSignboardDialog,
  requestDeleteSignboard,
  clearDeleteConfirm,
} = signboardSlice.actions

export default signboardSlice.reducer
