import React, { useRef } from 'react'
import styled from 'styled-components'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Button from '@mui/material/Button'
import CloseIcon from '@mui/icons-material/Close'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import FileDownloadIcon from '@mui/icons-material/FileDownload'
import FileUploadIcon from '@mui/icons-material/FileUpload'
import MeetingRoomIcon from '@mui/icons-material/MeetingRoom'

import { useAppSelector, useAppDispatch } from '../hooks'
import {
  toggleBuilderMode,
  setSelectedPaletteIndex,
  clearAllItems,
  importItems,
  setMeetingRoomEntrance,
  PALETTE_ITEMS,
  PlacedItem,
} from '../stores/MapBuilderStore'
import { phaserEvents, Event } from '../events/EventCenter'

// ─── Styled Components ───────────────────────────────────────────────────────

const Panel = styled.div`
  position: fixed;
  top: 376px;                          /* VideoOverlay(360px) + 余白16px */
  left: 16px;
  width: 440px;
  background: #1a1d2e;
  border-radius: 16px;
  box-shadow: 0 6px 32px rgba(0, 0, 0, 0.6);
  color: #eee;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 1000;
  user-select: none;
  max-height: calc(100vh - 392px);     /* 画面下端まで */
  overflow-y: auto;
`

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 20px 14px 28px;
  background: #12152a;
  border-bottom: 2px solid #2d3255;
`

const Title = styled.h3`
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  color: #7eb8f7;
  letter-spacing: 0.5px;
`

const SectionLabel = styled.div`
  font-size: 18px;
  color: #8888aa;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 16px 24px 10px;
`

const PaletteGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 6px 20px 20px;
`

const PaletteCard = styled.button<{ selected: boolean; itemType: string }>`
  background: ${({ selected }) => (selected ? '#2a4a7f' : '#252840')};
  border: 3px solid ${({ selected }) => (selected ? '#5599ee' : 'transparent')};
  border-radius: 12px;
  padding: 14px 8px 12px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  transition: background 0.15s, border-color 0.15s;
  color: #ddd;
  font-size: 18px;
  line-height: 1.3;
  text-align: center;

  &:hover {
    background: ${({ selected }) => (selected ? '#2a4a7f' : '#2e3255')};
    border-color: ${({ selected }) => (selected ? '#5599ee' : '#4466bb')};
  }
`

const ItemIcon = styled.div<{ itemType: string }>`
  font-size: 38px;
  line-height: 1;
`

const Divider = styled.div`
  height: 1px;
  background: #2d3255;
  margin: 0 20px;
`

const ActionRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 20px 20px;
`

const ActionButton = styled(Button)`
  && {
    font-size: 18px;
    padding: 10px 16px;
    border-radius: 10px;
    text-transform: none;
    justify-content: flex-start;
    gap: 10px;
    color: #ccc;
    border-color: #3a3e5c;

    &:hover {
      background: #252840;
      border-color: #5566aa;
    }
  }
`

const HintText = styled.div`
  font-size: 16px;
  color: #666899;
  padding: 0 24px 16px;
  line-height: 1.6;
`

// ─── Icon helpers ────────────────────────────────────────────────────────────

const ITEM_ICONS: Record<string, string> = {
  chair: '🪑',
  computer: '🖥️',
  whiteboard: '📋',
  vendingmachine: '🥤',
  meetingroom: 'MR',
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MapBuilder() {
  const dispatch = useAppDispatch()
  const selectedIndex = useAppSelector((state) => state.mapBuilder.selectedPaletteIndex)
  const placedItems = useAppSelector((state) => state.mapBuilder.placedItems)
  const meetingRoomEntrance = useAppSelector((state) => state.mapBuilder.meetingRoomEntrance)
  const importRef = useRef<HTMLInputElement>(null)

  const handleClose = () => {
    dispatch(toggleBuilderMode())
    phaserEvents.emit(Event.BUILDER_EXIT)
  }

  const handleSelectPalette = (index: number) => {
    dispatch(setSelectedPaletteIndex(selectedIndex === index ? null : index))
  }

  const handlePickMeetingEntrance = () => {
    dispatch(setSelectedPaletteIndex(null))
    phaserEvents.emit(Event.BUILDER_PICK_MEETING_ENTRANCE)
  }

  const handleClearAll = () => {
    if (placedItems.length === 0) return
    if (!window.confirm(`配置済みのアイテム ${placedItems.length} 個を全て削除しますか？`)) return
    dispatch(clearAllItems())
    phaserEvents.emit(Event.BUILDER_CLEAR)
  }

  const handleExport = () => {
    const json = JSON.stringify(placedItems, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'skyoffice_map.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const items = JSON.parse(ev.target?.result as string) as PlacedItem[]
        if (!Array.isArray(items)) throw new Error('invalid format')
        dispatch(importItems(items))
        phaserEvents.emit(Event.BUILDER_IMPORT)
      } catch {
        alert('JSONファイルの読み込みに失敗しました。')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <Panel>
      <Header>
        <Title>🗺️ マップビルダー</Title>
        <Tooltip title="ビルダーを閉じる">
          <IconButton size="small" onClick={handleClose} sx={{ color: '#888' }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Header>

      <SectionLabel>家具を選択</SectionLabel>
      <PaletteGrid>
        {PALETTE_ITEMS.map((item, index) => (
          <PaletteCard
            key={index}
            selected={selectedIndex === index}
            itemType={item.itemType}
            onClick={() => handleSelectPalette(index)}
          >
            <ItemIcon itemType={item.itemType}>{ITEM_ICONS[item.itemType]}</ItemIcon>
            {item.label}
          </PaletteCard>
        ))}
      </PaletteGrid>

      {selectedIndex !== null ? (
        <HintText>
          クリックでマップに配置<br />
          右クリックで削除 · ドラッグで移動
        </HintText>
      ) : (
        <HintText>
          アイテムを選択してクリックで配置<br />
          ドラッグで既存アイテムを移動
        </HintText>
      )}

      <Divider />

      <ActionRow>
        <ActionButton
          variant="outlined"
          size="small"
          startIcon={<MeetingRoomIcon fontSize="small" />}
          onClick={handlePickMeetingEntrance}
        >
          入口マス指定
          {meetingRoomEntrance ? ` (${meetingRoomEntrance.x}, ${meetingRoomEntrance.y})` : ''}
        </ActionButton>
        <ActionButton
          variant="outlined"
          size="small"
          startIcon={<MeetingRoomIcon fontSize="small" />}
          onClick={() => {
            dispatch(setMeetingRoomEntrance(null))
            phaserEvents.emit(Event.BUILDER_IMPORT)
          }}
          disabled={!meetingRoomEntrance}
        >
          入口を解除
        </ActionButton>
        <ActionButton
          variant="outlined"
          size="small"
          startIcon={<DeleteSweepIcon fontSize="small" />}
          onClick={handleClearAll}
          disabled={placedItems.length === 0}
        >
          全て削除 ({placedItems.length})
        </ActionButton>
        <ActionButton
          variant="outlined"
          size="small"
          startIcon={<FileDownloadIcon fontSize="small" />}
          onClick={handleExport}
          disabled={placedItems.length === 0}
        >
          JSONエクスポート
        </ActionButton>
        <ActionButton
          variant="outlined"
          size="small"
          startIcon={<FileUploadIcon fontSize="small" />}
          onClick={() => importRef.current?.click()}
        >
          JSONインポート
        </ActionButton>
        <input
          ref={importRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleImport}
        />
      </ActionRow>
    </Panel>
  )
}
