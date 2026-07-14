import { createSlice } from '@reduxjs/toolkit'

import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'

interface UiState {
  exitDialogOpen: boolean
}

const initialState: UiState = {
  exitDialogOpen: false,
}

export const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    openExitDialog: (state) => {
      state.exitDialogOpen = true
      const game = phaserGame.scene.keys.game as Game
      game?.disableKeys()
    },
    closeExitDialog: (state) => {
      state.exitDialogOpen = false
      const game = phaserGame.scene.keys.game as Game
      game?.enableKeys()
    },
  },
})

export const { openExitDialog, closeExitDialog } = uiSlice.actions

export default uiSlice.reducer
