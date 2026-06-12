import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface BotPrediction {
  name: string
  role: string
  desk?: 'A' | 'B' | 'C'
  prediction: string
}

export interface DebateSummary {
  agentA: string
  agentB: string
  topic: string
  exchanges: Array<{ speaker: string; message: string }>
}

interface PredictionBoardState {
  dialogOpen: boolean
  predictions: BotPrediction[]
  debates: DebateSummary[]
  consensus: string
  mission: string
  loading: boolean
  lastFetched: number
}

const initialState: PredictionBoardState = {
  dialogOpen: false,
  predictions: [],
  debates: [],
  consensus: '',
  mission: '',
  loading: false,
  lastFetched: 0,
}

export const predictionBoardSlice = createSlice({
  name: 'predictionBoard',
  initialState,
  reducers: {
    openPredictionBoardDialog: (state) => {
      state.dialogOpen = true
    },
    closePredictionBoardDialog: (state) => {
      state.dialogOpen = false
    },
    setAgentState: (state, action: PayloadAction<{
      predictions: BotPrediction[]
      debates: DebateSummary[]
      consensus: string
      mission: string
    }>) => {
      state.predictions = action.payload.predictions
      state.debates = action.payload.debates
      state.consensus = action.payload.consensus
      state.mission = action.payload.mission
      state.lastFetched = Date.now()
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload
    },
  },
})

export const {
  openPredictionBoardDialog,
  closePredictionBoardDialog,
  setAgentState,
  setLoading,
} = predictionBoardSlice.actions

export default predictionBoardSlice.reducer
