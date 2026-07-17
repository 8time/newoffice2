import { enableMapSet } from 'immer'
import { configureStore } from '@reduxjs/toolkit'
import userReducer from './UserStore'
import computerReducer from './ComputerStore'
import whiteboardReducer from './WhiteboardStore'
import chatReducer from './ChatStore'
import roomReducer from './RoomStore'
import mapBuilderReducer from './MapBuilderStore'
import jukeboxReducer from './JukeboxStore'
import meetingRoomReducer from './MeetingRoomStore'
import signboardReducer from './SignboardStore'
import predictionBoardReducer from './PredictionBoardStore'
import uiReducer from './UiStore'
import settingsReducer from './SettingsStore'
import dmReducer from './DMStore'
import stampReducer from './StampStore'

enableMapSet()

const store = configureStore({
  reducer: {
    user: userReducer,
    computer: computerReducer,
    whiteboard: whiteboardReducer,
    chat: chatReducer,
    room: roomReducer,
    mapBuilder: mapBuilderReducer,
    jukebox: jukeboxReducer,
    meetingRoom: meetingRoomReducer,
    signboard: signboardReducer,
    predictionBoard: predictionBoardReducer,
    ui: uiReducer,
    settings: settingsReducer,
    dm: dmReducer,
    stamp: stampReducer,
  },
  // Temporary disable serialize check for redux as we store MediaStream in ComputerStore.
  // https://stackoverflow.com/a/63244831
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
})

// 開発時のみ、E2Eテスト（Playwright）からReduxストアを操作できるように公開する。
// 会議室の入室などはPhaserのマップ上を歩く必要があり、ブラウザ自動化から
// 到達させるのが困難なため、テストではここからアクションをdispatchする。
if (import.meta.env.DEV) {
  ;(window as any).__store = store
}

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>
// Inferred type: {posts: PostsState, comments: CommentsState, users: UsersState}
export type AppDispatch = typeof store.dispatch

export default store
