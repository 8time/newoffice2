import { createSlice, PayloadAction } from '@reduxjs/toolkit'

import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'

interface WhiteboardState {
  whiteboardDialogOpen: boolean
  whiteboardId: null | string
}

const initialState: WhiteboardState = {
  whiteboardDialogOpen: false,
  whiteboardId: null,
}

export const whiteboardSlice = createSlice({
  name: 'whiteboard',
  initialState,
  reducers: {
    openWhiteboardDialog: (state, action: PayloadAction<string>) => {
      state.whiteboardDialogOpen = true
      state.whiteboardId = action.payload
      const game = phaserGame.scene.keys.game as Game
      game.disableKeys()
    },
    closeWhiteboardDialog: (state) => {
      const game = phaserGame.scene.keys.game as Game
      game.enableKeys()
      game.network.disconnectFromWhiteboard(state.whiteboardId!)
      state.whiteboardDialogOpen = false
      state.whiteboardId = null
    },
  },
})

export const { openWhiteboardDialog, closeWhiteboardDialog } = whiteboardSlice.actions

export default whiteboardSlice.reducer
