import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { IChatMessage } from '../../../types/IOfficeState'
import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'

export enum MessageType {
  PLAYER_JOINED,
  PLAYER_LEFT,
  REGULAR_MESSAGE,
  FILE_MESSAGE,
}

export interface FileAttachment {
  name: string
  type: string        // MIME type
  url: string         // object URL or data URL
  size: number        // bytes
}

export interface ChatEntry {
  messageType: MessageType
  chatMessage: IChatMessage
  file?: FileAttachment
}

export const chatSlice = createSlice({
  name: 'chat',
  initialState: {
    chatMessages: new Array<ChatEntry>(),
    focused: false,
    showChat: true,
  },
  reducers: {
    pushChatMessage: (state, action: PayloadAction<IChatMessage>) => {
      // JSONシリアライズ可能な形でコピー
      const payload = { ...action.payload, readers: action.payload.readers ? Array.from(action.payload.readers) : [] }
      state.chatMessages.push({
        messageType: MessageType.REGULAR_MESSAGE,
        chatMessage: payload as any,
      })
    },
    updateChatReaders: (state, action: PayloadAction<{ id: string; readers: string[] }>) => {
      const msg = state.chatMessages.find(m => m.chatMessage.id === action.payload.id)
      if (msg) {
        msg.chatMessage.readers = action.payload.readers
      }
    },
    pushFileMessage: (
      state,
      action: PayloadAction<{ author: string; file: FileAttachment }>
    ) => {
      state.chatMessages.push({
        messageType: MessageType.FILE_MESSAGE,
        chatMessage: {
          createdAt: new Date().getTime(),
          author: action.payload.author,
          content: `[ファイル] ${action.payload.file.name}`,
        } as IChatMessage,
        file: action.payload.file,
      })
    },
    pushPlayerJoinedMessage: (state, action: PayloadAction<string>) => {
      state.chatMessages.push({
        messageType: MessageType.PLAYER_JOINED,
        chatMessage: {
          createdAt: new Date().getTime(),
          author: action.payload,
          content: 'が入室しました',
        } as IChatMessage,
      })
    },
    pushPlayerLeftMessage: (state, action: PayloadAction<string>) => {
      state.chatMessages.push({
        messageType: MessageType.PLAYER_LEFT,
        chatMessage: {
          createdAt: new Date().getTime(),
          author: action.payload,
          content: 'が退室しました',
        } as IChatMessage,
      })
    },
    setFocused: (state, action: PayloadAction<boolean>) => {
      const game = phaserGame.scene.keys.game as Game
      action.payload ? game.disableKeys() : game.enableKeys()
      state.focused = action.payload
    },
    setShowChat: (state, action: PayloadAction<boolean>) => {
      state.showChat = action.payload
    },
  },
})

export const {
  pushChatMessage,
  pushFileMessage,
  pushPlayerJoinedMessage,
  pushPlayerLeftMessage,
  setFocused,
  setShowChat,
  updateChatReaders,
} = chatSlice.actions

export default chatSlice.reducer
