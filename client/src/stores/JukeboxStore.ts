import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface Song {
  name: string
  url: string
  isLocal: boolean // ローカルアップロードされた一時URLかどうか
}

interface JukeboxState {
  jukeboxDialogOpen: boolean
  playing: boolean
  paused: boolean
  currentSongName: string
  currentSongIndex: number
  repeat: boolean
  playlist: Song[]
  volume: number
  // 自分が選んだ曲を他の人のMAPでも流すかどうか。OFFなら自分だけに聞こえる。
  // （他の人が配信している曲は、この設定に関わらず自分にも聞こえる）
  broadcast: boolean
}

const initialState: JukeboxState = {
  jukeboxDialogOpen: false,
  playing: false,
  paused: false,
  currentSongName: '',
  currentSongIndex: -1,
  repeat: false,
  broadcast: true,
  playlist: [
    { name: 'SoundHelix Song 1', url: 'assets/audio/song1.mp3', isLocal: false },
    { name: 'SoundHelix Song 2', url: 'assets/audio/song2.mp3', isLocal: false },
  ],
  volume: 0.5,
}

export const jukeboxSlice = createSlice({
  name: 'jukebox',
  initialState,
  reducers: {
    openJukeboxDialog: (state) => {
      state.jukeboxDialogOpen = true
    },
    closeJukeboxDialog: (state) => {
      state.jukeboxDialogOpen = false
    },
    setPlayState: (state, action: PayloadAction<{ playing: boolean; paused: boolean }>) => {
      state.playing = action.payload.playing
      state.paused = action.payload.paused
    },
    setCurrentSong: (state, action: PayloadAction<{ name: string; index: number }>) => {
      state.currentSongName = action.payload.name
      state.currentSongIndex = action.payload.index
    },
    toggleRepeat: (state) => {
      state.repeat = !state.repeat
    },
    toggleBroadcast: (state) => {
      state.broadcast = !state.broadcast
    },
    addSongToPlaylist: (state, action: PayloadAction<Song>) => {
      state.playlist.push(action.payload)
    },
    setPlaylist: (state, action: PayloadAction<Song[]>) => {
      state.playlist = action.payload
    },
    playSongByIndex: (state, action: PayloadAction<number>) => {
      const idx = action.payload
      if (idx >= 0 && idx < state.playlist.length) {
        state.currentSongIndex = idx
        state.currentSongName = state.playlist[idx].name
        state.playing = true
        state.paused = false
      }
    },
    setVolume: (state, action: PayloadAction<number>) => {
      state.volume = action.payload
    },
  },
})

export const {
  openJukeboxDialog,
  closeJukeboxDialog,
  setPlayState,
  setCurrentSong,
  toggleRepeat,
  toggleBroadcast,
  addSongToPlaylist,
  setPlaylist,
  playSongByIndex,
  setVolume,
} = jukeboxSlice.actions

export default jukeboxSlice.reducer
