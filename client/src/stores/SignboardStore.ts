import { createSlice } from '@reduxjs/toolkit'

interface SignboardState {
  signboardDialogOpen: boolean
}

const initialState: SignboardState = {
  signboardDialogOpen: false,
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
  },
})

export const { openSignboardDialog, closeSignboardDialog } = signboardSlice.actions

export default signboardSlice.reducer
