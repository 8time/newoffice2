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

const STORAGE_KEY = 'skyoffice_builder_items'
const MEETING_ENTRANCE_STORAGE_KEY = 'skyoffice_meeting_room_entrance'

const loadFromStorage = (): PlacedItem[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : []
  } catch {
    return []
  }
}

const saveToStorage = (items: PlacedItem[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {}
}

const loadMeetingEntrance = (): MeetingRoomEntrance | null => {
  try {
    const saved = localStorage.getItem(MEETING_ENTRANCE_STORAGE_KEY)
    return saved ? JSON.parse(saved) : null
  } catch {
    return null
  }
}

const saveMeetingEntrance = (entrance: MeetingRoomEntrance | null) => {
  try {
    if (entrance) {
      localStorage.setItem(MEETING_ENTRANCE_STORAGE_KEY, JSON.stringify(entrance))
    } else {
      localStorage.removeItem(MEETING_ENTRANCE_STORAGE_KEY)
    }
  } catch {}
}

const initialState: MapBuilderState = {
  isBuilderMode: false,
  selectedPaletteIndex: null,
  placedItems: loadFromStorage(),
  meetingRoomEntrance: loadMeetingEntrance(),
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
      saveToStorage(state.placedItems)
    },
    removePlacedItem(state, action: PayloadAction<string>) {
      state.placedItems = state.placedItems.filter((i) => i.id !== action.payload)
      saveToStorage(state.placedItems)
    },
    updatePlacedItemPosition(state, action: PayloadAction<{ id: string; x: number; y: number }>) {
      const item = state.placedItems.find((i) => i.id === action.payload.id)
      if (item) {
        item.x = action.payload.x
        item.y = action.payload.y
        saveToStorage(state.placedItems)
      }
    },
    clearAllItems(state) {
      state.placedItems = []
      localStorage.removeItem(STORAGE_KEY)
    },
    importItems(state, action: PayloadAction<PlacedItem[]>) {
      state.placedItems = action.payload
      saveToStorage(state.placedItems)
    },
    setMeetingRoomEntrance(state, action: PayloadAction<MeetingRoomEntrance | null>) {
      state.meetingRoomEntrance = action.payload
      saveMeetingEntrance(action.payload)
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
