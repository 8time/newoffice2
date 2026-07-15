import { createSlice } from '@reduxjs/toolkit'

import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'

interface SettingsState {
  settingsDialogOpen: boolean
}

const initialState: SettingsState = {
  settingsDialogOpen: false,
}

export const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    openSettingsDialog: (state) => {
      state.settingsDialogOpen = true
      const game = phaserGame.scene.keys.game as Game
      game?.disableKeys()
    },
    closeSettingsDialog: (state) => {
      state.settingsDialogOpen = false
      const game = phaserGame.scene.keys.game as Game
      game?.enableKeys()
    },
  },
})

export const { openSettingsDialog, closeSettingsDialog } = settingsSlice.actions

export default settingsSlice.reducer
