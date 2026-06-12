import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface PlacedItem {
  id: string
  itemType: 'chair' | 'computer' | 'whiteboard' | 'vendingmachine' | 'meetingroom'
  x: number
  y: number
  frame: number
  direction?: string
}

export interface PaletteItem {
  itemType: PlacedItem['itemType']
  frame: number
  direction?: string
  label: string
}

export interface MeetingRoomEntrance {
  x: number
  y: number
}

export const PALETTE_ITEMS: PaletteItem[] = [
  { itemType: 'chair', frame: 0, direction: 'down', label: '椅子 (前)' },
  { itemType: 'chair', frame: 1, direction: 'up', label: '椅子 (後)' },
  { itemType: 'chair', frame: 2, direction: 'left', label: '椅子 (左)' },
  { itemType: 'chair', frame: 3, direction: 'right', label: '椅子 (右)' },
  { itemType: 'computer', frame: 0, label: 'コンピュータ' },
  { itemType: 'whiteboard', frame: 0, label: 'ホワイトボード' },
  { itemType: 'vendingmachine', frame: 0, label: '自販機' },
  { itemType: 'meetingroom', frame: 0, label: 'Meeting Room' },
]

interface MapBuilderState {
  isBuilderMode: boolean
  selectedPaletteIndex: number | null
  placedItems: PlacedItem[]
  meetingRoomEntrance: MeetingRoomEntrance | null
}

// 設置物はサーバ権威の同期状態（builder.json）。このストアはサーバからの
// エコーで更新されるローカルミラーであり、localStorageからの初期ロードは行わない。
const initialState: MapBuilderState = {
  isBuilderMode: false,
  selectedPaletteIndex: null,
  placedItems: [],
  meetingRoomEntrance: null,
}

const mapBuilderSlice = createSlice({
  name: 'mapBuilder',
  initialState,
  reducers: {
    toggleBuilderMode(state) {
      state.isBuilderMode = !state.isBuilderMode
      if (!state.isBuilderMode) {
        state.selectedPaletteIndex = null
      }
    },
    setSelectedPaletteIndex(state, action: PayloadAction<number | null>) {
      state.selectedPaletteIndex = action.payload
    },
    addPlacedItem(state, action: PayloadAction<PlacedItem>) {
      state.placedItems.push(action.payload)
    },
    removePlacedItem(state, action: PayloadAction<string>) {
      state.placedItems = state.placedItems.filter((i) => i.id !== action.payload)
    },
    updatePlacedItemPosition(state, action: PayloadAction<{ id: string; x: number; y: number }>) {
      const item = state.placedItems.find((i) => i.id === action.payload.id)
      if (item) {
        item.x = action.payload.x
        item.y = action.payload.y
      }
    },
    clearAllItems(state) {
      state.placedItems = []
    },
    importItems(state, action: PayloadAction<PlacedItem[]>) {
      state.placedItems = action.payload
    },
    setMeetingRoomEntrance(state, action: PayloadAction<MeetingRoomEntrance | null>) {
      state.meetingRoomEntrance = action.payload
    },
  },
})

export const {
  toggleBuilderMode,
  setSelectedPaletteIndex,
  addPlacedItem,
  removePlacedItem,
  updatePlacedItemPosition,
  clearAllItems,
  importItems,
  setMeetingRoomEntrance,
} = mapBuilderSlice.actions

export default mapBuilderSlice.reducer
