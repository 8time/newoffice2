import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface MeetingRoomDefinition {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  returnX: number
  returnY: number
}

interface MeetingRoomState {
  activeRoom: MeetingRoomDefinition | null
}

const initialState: MeetingRoomState = {
  activeRoom: null,
}

const meetingRoomSlice = createSlice({
  name: 'meetingRoom',
  initialState,
  reducers: {
    setActiveMeetingRoom(state, action: PayloadAction<MeetingRoomDefinition>) {
      state.activeRoom = action.payload
    },
    clearActiveMeetingRoom(state) {
      state.activeRoom = null
    },
  },
})

export const { setActiveMeetingRoom, clearActiveMeetingRoom } = meetingRoomSlice.actions

export default meetingRoomSlice.reducer
