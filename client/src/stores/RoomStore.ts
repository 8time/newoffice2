import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { RoomAvailable } from 'colyseus.js'
import { RoomType } from '../../../types/Rooms'

interface RoomInterface extends RoomAvailable {
  name?: string
}

/**
 * Colyseus' real time room list always includes the public lobby so we have to remove it manually.
 */
const isCustomRoom = (room: RoomInterface) => {
  return room.name === RoomType.CUSTOM
}

export const roomSlice = createSlice({
  name: 'room',
  initialState: {
    lobbyJoined: false,
    roomJoined: false,
    roomId: '',
    roomName: '',
    roomDescription: '',
    roomKey: '',
    // 現在の固定ルームに入室パスワード（合言葉）が設定されているか
    roomHasPassword: false,
    availableRooms: new Array<RoomAvailable>(),
    // サーバーから切断された理由。'other-tab' は同じブラウザの別タブで
    // 同じ部屋を開いたため、このタブが追い出されたことを表す
    disconnectReason: '' as '' | 'other-tab' | 'lost',
  },
  reducers: {
    setLobbyJoined: (state, action: PayloadAction<boolean>) => {
      state.lobbyJoined = action.payload
    },
    setRoomKey: (state, action: PayloadAction<string>) => {
      state.roomKey = action.payload
    },
    setRoomHasPassword: (state, action: PayloadAction<boolean>) => {
      state.roomHasPassword = action.payload
    },
    setRoomJoined: (state, action: PayloadAction<boolean>) => {
      state.roomJoined = action.payload
    },
    setDisconnectReason: (state, action: PayloadAction<'' | 'other-tab' | 'lost'>) => {
      state.disconnectReason = action.payload
    },
    setJoinedRoomData: (
      state,
      action: PayloadAction<{ id: string; name: string; description: string }>
    ) => {
      state.roomId = action.payload.id
      state.roomName = action.payload.name
      state.roomDescription = action.payload.description
    },
    setAvailableRooms: (state, action: PayloadAction<RoomAvailable[]>) => {
      state.availableRooms = action.payload.filter((room) => isCustomRoom(room))
    },
    addAvailableRooms: (state, action: PayloadAction<{ roomId: string; room: RoomAvailable }>) => {
      if (!isCustomRoom(action.payload.room)) return
      const roomIndex = state.availableRooms.findIndex(
        (room) => room.roomId === action.payload.roomId
      )
      if (roomIndex !== -1) {
        state.availableRooms[roomIndex] = action.payload.room
      } else {
        state.availableRooms.push(action.payload.room)
      }
    },
    removeAvailableRooms: (state, action: PayloadAction<string>) => {
      state.availableRooms = state.availableRooms.filter((room) => room.roomId !== action.payload)
    },
  },
})

export const {
  setLobbyJoined,
  setRoomJoined,
  setDisconnectReason,
  setRoomKey,
  setRoomHasPassword,
  setJoinedRoomData,
  setAvailableRooms,
  addAvailableRooms,
  removeAvailableRooms,
} = roomSlice.actions

export default roomSlice.reducer
