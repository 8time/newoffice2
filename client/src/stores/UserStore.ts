import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { sanitizeId } from '../util'
import { BackgroundMode } from '../../../types/BackgroundMode'

import phaserGame from '../PhaserGame'
import Bootstrap from '../scenes/Bootstrap'

export function getInitialBackgroundMode() {
  const currentHour = new Date().getHours()
  return currentHour > 6 && currentHour <= 18 ? BackgroundMode.DAY : BackgroundMode.NIGHT
}

export const userSlice = createSlice({
  name: 'user',
  initialState: {
    backgroundMode: getInitialBackgroundMode(),
    sessionId: '',
    videoConnected: false,
    loggedIn: false,
    playerNameMap: new Map<string, string>(),
    showJoystick: window.innerWidth < 650,
    myStatus: 'present' as 'present' | 'away' | 'focus' | 'break',
    myAwayMessage: '',
    playerStatusMap: new Map<string, { status: string; awayMessage: string }>(),
    playerHandRaisedMap: new Map<string, boolean>(),
    playerMeetingRoomMap: new Map<string, string>(),
    playerAudioMutedMap: new Map<string, boolean>(),
    playerScreenSharingMap: new Map<string, boolean>(),
    avatarName: 'adam',
    playerName: '',
  },
  reducers: {
    toggleBackgroundMode: (state) => {
      const newMode =
        state.backgroundMode === BackgroundMode.DAY ? BackgroundMode.NIGHT : BackgroundMode.DAY

      state.backgroundMode = newMode
      const bootstrap = phaserGame.scene.keys.bootstrap as Bootstrap
      bootstrap.changeBackgroundMode(newMode)
    },
    setSessionId: (state, action: PayloadAction<string>) => {
      state.sessionId = action.payload
    },
    setVideoConnected: (state, action: PayloadAction<boolean>) => {
      state.videoConnected = action.payload
    },
    setLoggedIn: (state, action: PayloadAction<boolean>) => {
      state.loggedIn = action.payload
    },
    setPlayerNameMap: (state, action: PayloadAction<{ id: string; name: string }>) => {
      state.playerNameMap.set(sanitizeId(action.payload.id), action.payload.name)
    },
    removePlayerNameMap: (state, action: PayloadAction<string>) => {
      state.playerNameMap.delete(sanitizeId(action.payload))
    },
    setShowJoystick: (state, action: PayloadAction<boolean>) => {
      state.showJoystick = action.payload
    },
    setMyStatus: (
      state,
      action: PayloadAction<{ status: 'present' | 'away' | 'focus' | 'break'; awayMessage: string }>
    ) => {
      state.myStatus = action.payload.status
      state.myAwayMessage = action.payload.awayMessage
    },
    setPlayerStatus: (
      state,
      action: PayloadAction<{ id: string; status: string; awayMessage: string }>
    ) => {
      state.playerStatusMap.set(sanitizeId(action.payload.id), {
        status: action.payload.status,
        awayMessage: action.payload.awayMessage,
      })
    },
    removePlayerStatus: (state, action: PayloadAction<string>) => {
      state.playerStatusMap.delete(sanitizeId(action.payload))
    },
    setPlayerHandRaised: (state, action: PayloadAction<{ id: string; handRaised: boolean }>) => {
      state.playerHandRaisedMap.set(sanitizeId(action.payload.id), action.payload.handRaised)
    },
    removePlayerHandRaised: (state, action: PayloadAction<string>) => {
      state.playerHandRaisedMap.delete(sanitizeId(action.payload))
    },
    setPlayerMeetingRoomId: (state, action: PayloadAction<{ id: string; meetingRoomId: string }>) => {
      state.playerMeetingRoomMap.set(sanitizeId(action.payload.id), action.payload.meetingRoomId)
    },
    removePlayerMeetingRoomId: (state, action: PayloadAction<string>) => {
      state.playerMeetingRoomMap.delete(sanitizeId(action.payload))
    },
    setPlayerAudioMuted: (state, action: PayloadAction<{ id: string; isAudioMuted: boolean }>) => {
      state.playerAudioMutedMap.set(sanitizeId(action.payload.id), action.payload.isAudioMuted)
    },
    removePlayerAudioMuted: (state, action: PayloadAction<string>) => {
      state.playerAudioMutedMap.delete(sanitizeId(action.payload))
    },
    setPlayerScreenSharing: (state, action: PayloadAction<{ id: string; isScreenSharing: boolean }>) => {
      state.playerScreenSharingMap.set(sanitizeId(action.payload.id), action.payload.isScreenSharing)
    },
    removePlayerScreenSharing: (state, action: PayloadAction<string>) => {
      state.playerScreenSharingMap.delete(sanitizeId(action.payload))
    },
    setAvatarName: (state, action: PayloadAction<string>) => {
      state.avatarName = action.payload
    },
    setPlayerName: (state, action: PayloadAction<string>) => {
      state.playerName = action.payload
    },
  },
})

export const {
  toggleBackgroundMode,
  setSessionId,
  setVideoConnected,
  setLoggedIn,
  setPlayerNameMap,
  removePlayerNameMap,
  setShowJoystick,
  setMyStatus,
  setPlayerStatus,
  removePlayerStatus,
  setPlayerHandRaised,
  removePlayerHandRaised,
  setPlayerMeetingRoomId,
  removePlayerMeetingRoomId,
  setPlayerAudioMuted,
  removePlayerAudioMuted,
  setPlayerScreenSharing,
  removePlayerScreenSharing,
  setAvatarName,
  setPlayerName,
} = userSlice.actions

export default userSlice.reducer
