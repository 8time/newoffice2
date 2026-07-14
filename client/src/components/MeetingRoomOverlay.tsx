import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import Tooltip from '@mui/material/Tooltip'
import IconButton from '@mui/material/IconButton'
import MicIcon from '@mui/icons-material/Mic'
import MicOffIcon from '@mui/icons-material/MicOff'
import VideocamIcon from '@mui/icons-material/Videocam'
import VideocamOffIcon from '@mui/icons-material/VideocamOff'
import ScreenShareIcon from '@mui/icons-material/ScreenShare'
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare'
import ExitToAppIcon from '@mui/icons-material/ExitToApp'
import PeopleIcon from '@mui/icons-material/People'
import ChatIcon from '@mui/icons-material/Chat'
import PanToolIcon from '@mui/icons-material/PanTool'

import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'
import { useAppDispatch, useAppSelector } from '../hooks'
import { clearActiveMeetingRoom } from '../stores/MeetingRoomStore'
import { phaserEvents, Event as PhaserEvent } from '../events/EventCenter'
import CollaborativeWhiteboard, { ExcalidrawGlobal } from './CollaborativeWhiteboard'

import Adam from '../images/login/Adam_login.png'
import Ash from '../images/login/Ash_login.png'
import Lucy from '../images/login/Lucy_login.png'
import Nancy from '../images/login/Nancy_login.png'

const avatarMap: Record<string, string> = {
  adam: Adam,
  ash: Ash,
  lucy: Lucy,
  nancy: Nancy,
}

const avatarGradients = [
  'linear-gradient(135deg, #4b6cb7cc 0%, #182848cc 100%)',
  'linear-gradient(135deg, #ff7e50cc 0%, #c0392bcc 100%)',
  'linear-gradient(135deg, #11998ecc 0%, #38ef7dcc 100%)',
  'linear-gradient(135deg, #ff0844cc 0%, #ffb199cc 100%)',
  'linear-gradient(135deg, #8E2DE2cc 0%, #4A00E0cc 100%)',
  'linear-gradient(135deg, #f12711cc 0%, #f5af19cc 100%)',
  'linear-gradient(135deg, #00B4DBcc 0%, #0083B0cc 100%)',
  'linear-gradient(135deg, #b92b27cc 0%, #1565C0cc 100%)',
]

function getGradient(id: string) {
  if (!id) return avatarGradients[0]
  let sum = 0
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i)
  return avatarGradients[sum % avatarGradients.length]
}

// ─── ビューモード ─────────────────────────────────────────────────────────────

type ViewMode = 'document' | 'both' | 'canvas'
const DOC_STORAGE_PREFIX = 'skyoffice_meeting_doc_'
const VIEW_MODE_PREFIX   = 'skyoffice_meeting_viewmode_'

// ─── タブ管理 ─────────────────────────────────────────────────────────────────

interface WBTab {
  id: string
  name: string
  color?: string
}

const TABS_PREFIX = 'skyoffice_meeting_tabs_'
const TAB_COLORS = ['#ffccbc', '#c8e6c9', '#b3e5fc', '#d1c4e9', '#ffecb3', '#f8bbd0', '#cfd8dc']

function loadTabs(roomId: string): WBTab[] {
  try {
    const saved = localStorage.getItem(TABS_PREFIX + roomId)
    if (saved) {
      const arr = JSON.parse(saved) as WBTab[]
      if (arr.length > 0) return arr
    }
  } catch {}
  return [{ id: 'tab_default', name: '議題①', color: TAB_COLORS[0] }]
}

function saveTabs(roomId: string, tabs: WBTab[]) {
  try { localStorage.setItem(TABS_PREFIX + roomId, JSON.stringify(tabs)) } catch {}
}

// ─── サイズ定数 ───────────────────────────────────────────────────────────────
const CAM_W = 280       // 右側カメラ列の幅（px）
const CAM_ASPECT = 3/4  // 縦長（4:3 portrait）
const CAM_H = Math.round(CAM_W / CAM_ASPECT * (3/4)) // ≈210px
const BAR_H = 160       // 下部コントロールバー高さ

// ─── Layout ──────────────────────────────────────────────────────────────────

const Shell = styled.div`
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: grid;
  grid-template-columns: 1fr ${CAM_W}px;
  grid-template-rows: 1fr ${BAR_H}px;
  background: #1a1a1a;
  color: #f0f0f0;
  pointer-events: auto;
  overflow: hidden;
`

/* ──── 左上：ホワイトボードエリア（タブバー＋キャンバス） ──────────────── */
const WhiteboardArea = styled.div`
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  position: relative;
`

/* ──── 画面共有／ホワイトボード切り替えバー ─────────────────────────────── */
const ScreenShareToggleBar = styled.div`
  display: flex;
  gap: 4px;
  background: #2a2a2a;
  padding: 8px 16px;
  flex-shrink: 0;
`

const ScreenShareToggleBtn = styled.button<{ active: boolean }>`
  padding: 8px 20px;
  border-radius: 8px;
  border: 2px solid ${({ active }) => (active ? '#42a5f5' : 'transparent')};
  background: ${({ active }) => (active ? '#1e3a5f' : 'transparent')};
  color: #eee;
  font-size: 14px;
  font-weight: ${({ active }) => (active ? '700' : '400')};
  cursor: pointer;

  &:hover { background: #1e3a5f; }
`

const ScreenShareView = styled.div`
  flex: 1;
  min-height: 0;
  background: #111;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;

  video { max-width: 100%; max-height: 100%; }
`

/* ──── タブバー ──────────────────────────────────────────────────────────── */

const TabBarWrap = styled.div`
  display: flex;
  align-items: flex-end;
  background: #e8e3d8;
  border-bottom: 2px solid #c5b99a;
  padding: 0 16px;
  gap: 4px;
  height: 84px;
  overflow-x: auto;
  flex-shrink: 0;

  &::-webkit-scrollbar { height: 6px; }
  &::-webkit-scrollbar-thumb { background: #aaa; border-radius: 3px; }
`

const TabItem = styled.div<{ active: boolean; $tabColor?: string }>`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 28px;
  height: 68px;
  border-radius: 14px 14px 0 0;
  cursor: pointer;
  background: ${({ active, $tabColor }) => active ? '#fffaf0' : ($tabColor || '#d4cdc0')};
  border-top: 6px solid ${({ $tabColor }) => $tabColor || '#d4cdc0'};
  border-left: 1px solid #c5b99a;
  border-right: 1px solid #c5b99a;
  border-bottom: ${({ active }) => active ? '2px solid #fffaf0' : '2px solid #c5b99a'};
  opacity: ${({ active }) => active ? 1 : 0.85};
  font-size: 30px;
  font-weight: ${({ active }) => (active ? '700' : '500')};
  color: ${({ active }) => (active ? '#2a2014' : '#5a4e3e')};
  white-space: nowrap;
  user-select: none;
  flex-shrink: 0;
  transition: all 0.12s;

  &:hover {
    opacity: 1;
    background: ${({ active, $tabColor }) => active ? '#fffaf0' : ($tabColor || '#c8c1b4')};
  }
`

const TabInput = styled.input`
  border: none;
  outline: none;
  background: transparent;
  font-size: 30px;
  font-weight: 700;
  color: #2a2014;
  width: 220px;
`

const TabCloseBtn = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  font-size: 24px;
  color: #888;
  flex-shrink: 0;

  &:hover {
    background: rgba(0,0,0,0.15);
    color: #333;
  }
`

const AddTabBtn = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  border: none;
  background: transparent;
  font-size: 44px;
  color: #7a6e5e;
  cursor: pointer;
  flex-shrink: 0;
  margin-bottom: 4px;

  &:hover {
    background: rgba(0,0,0,0.12);
    color: #333;
  }
`

// 他の人がタブを切り替えたことを一時的に知らせるバナー
const SwitchNoticeBar = styled.div`
  position: absolute;
  top: 90px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(20, 20, 35, 0.9);
  color: #fff;
  font-size: 14px;
  padding: 8px 20px;
  border-radius: 20px;
  z-index: 20;
  pointer-events: none;
  box-shadow: 0 2px 10px rgba(0,0,0,0.3);
`

const WhiteboardPane = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

/* ──── ビューモード切替バー ───────────────────────────────────────────────── */

const ViewModeBar = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  background: #f0ebe0;
  border-bottom: 2px solid #c5b99a;
  padding: 10px 24px;
  gap: 4px;
  flex-shrink: 0;
  height: 72px;
`

const VMTab = styled.button<{ active: boolean }>`
  padding: 10px 40px;
  border-radius: 10px;
  border: 2px solid ${({ active }) => (active ? '#b09060' : 'transparent')};
  background: ${({ active }) => (active ? '#fffaf0' : 'transparent')};
  font-size: 28px;
  font-weight: ${({ active }) => (active ? '700' : '400')};
  color: ${({ active }) => (active ? '#2a2014' : '#7a6e5e')};
  cursor: pointer;
  transition: background 0.12s;

  &:hover {
    background: ${({ active }) => (active ? '#fffaf0' : 'rgba(0,0,0,0.07)')};
  }
`

/* ──── コンテンツ分割レイアウト ─────────────────────────────────────────── */

const ContentSplit = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
  overflow: hidden;
`

const CanvasPanel = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

/* ──── ドキュメントエディタ ─────────────────────────────────────────────── */

const DocPane = styled.div`
  flex: none;
  display: flex;
  flex-direction: column;
  background: #fff;
  overflow: hidden;
  min-width: 300px;
`

const ResizeHandle = styled.div`
  flex: none;
  width: 12px;
  background: #c5b99a;
  cursor: col-resize;
  transition: background 0.15s;
  position: relative;
  z-index: 1;

  &:hover, &.dragging {
    background: #926f45;
  }
`

const DocScrollArea = styled.div`
  flex: 1;
  overflow-y: auto;

  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-thumb { background: #ccc; border-radius: 2px; }
`

const DocTextArea = styled.textarea`
  display: block;
  width: 100%;
  min-height: 100%;
  box-sizing: border-box;
  border: none;
  outline: none;
  resize: none;
  padding: 40px 36px;
  font-size: 30px;
  line-height: 1.9;
  font-family: 'Noto Sans JP', 'Hiragino Kaku Gothic Pro', 'Yu Gothic', sans-serif;
  color: #1a1a1a;
  background: #fff;

  &::placeholder { color: #bbb; }
`

const DocToolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 18px;
  border-top: 1px solid #e0dbd0;
  background: #faf7f0;
  flex-shrink: 0;
  flex-wrap: wrap;
`

const DocBtn = styled.button`
  min-width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #555;
  font-size: 24px;
  font-weight: 600;
  cursor: pointer;
  padding: 0 12px;
  white-space: nowrap;

  &:hover {
    background: rgba(0,0,0,0.08);
    color: #222;
  }
`

const DocSep = styled.div`
  width: 1px;
  height: 36px;
  background: #d4cdc0;
  margin: 0 8px;
  flex-shrink: 0;
`

/* ──── 右上：カメラ列（縦積み・右揃え） ───────────────────────────────────── */
const CameraColumn = styled.div`
  grid-column: 2;
  grid-row: 1;
  background: #111;
  border-left: 2px solid #333;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  overflow-y: auto;
  overflow-x: hidden;

  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-thumb { background: #555; border-radius: 2px; }
`

const CamCard = styled.div`
  position: relative;
  width: ${CAM_W}px;
  height: ${CAM_H}px;
  flex-shrink: 0;
  background: #222;
  border-bottom: 2px solid #333;

  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scaleX(-1);
    display: block;
  }

  .cam-label {
    position: absolute;
    bottom: 8px;
    left: 10px;
    right: 10px;
    font-size: 20px;
    font-weight: 600;
    color: #fff;
    background: rgba(0,0,0,0.65);
    border-radius: 6px;
    padding: 3px 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const AvatarFallback = styled.div<{ $bgGradient: string }>`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${({ $bgGradient }) => $bgGradient};
  position: relative;
  
  img {
    height: 70%;
    object-fit: contain;
    image-rendering: pixelated;
    filter: drop-shadow(0px 8px 12px rgba(0,0,0,0.6));
  }
`

/* 他者ビデオを縦積みにするコンテナ（WebRTCのDOM要素を受け取る） */
const PeerVideosColumn = styled.div`
  display: contents;   /* 子の video や wrapper を CameraColumn の直接 flex 子として扱う */

  .peer-video-wrapper {
    width: ${CAM_W}px !important;
    height: ${CAM_H}px !important;
    flex-shrink: 0;
  }

  video {
    width: 100% !important;
    height: 100% !important;
    object-fit: cover;
    border-bottom: 2px solid #333;
    flex-shrink: 0;
    display: block;
  }
`

/* ──── 下部コントロールバー（全幅） ─────────────────────────────────────── */
const BottomBar = styled.div`
  grid-column: 1 / -1;
  grid-row: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #111;
  border-top: 2px solid #333;
  padding: 0 40px;
  height: ${BAR_H}px;
`

const BarGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const CtrlBtn = styled.div<{ isOff?: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 20px;
  border-radius: 16px;
  cursor: pointer;
  background: ${({ isOff }) => (isOff ? 'rgba(220,50,50,0.25)' : 'transparent')};
  transition: background 0.15s;

  &:hover {
    background: ${({ isOff }) => (isOff ? 'rgba(220,50,50,0.4)' : 'rgba(255,255,255,0.12)')};
  }

  svg {
    font-size: 52px !important;
    color: ${({ isOff }) => (isOff ? '#ff6666' : '#fff')};
  }

  .clabel {
    font-size: 22px;
    color: #bbb;
    white-space: nowrap;
  }
`

const ExitBtn = styled.button`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 32px;
  border-radius: 16px;
  background: #cc1f1f;
  border: none;
  cursor: pointer;
  color: #fff;
  transition: background 0.15s;

  &:hover { background: #ff2828; }

  svg { font-size: 52px !important; }

  .clabel {
    font-size: 22px;
    font-weight: 700;
  }
`

/* 参加者パネル（右側にオーバーレイ表示） */
const MembersPanel = styled.div<{ open: boolean }>`
  display: ${({ open }) => (open ? 'flex' : 'none')};
  position: absolute;
  right: ${CAM_W}px;
  top: 0;
  bottom: ${BAR_H}px;
  width: 340px;
  background: #1e1e1e;
  border-left: 1px solid #444;
  z-index: 10;
  flex-direction: column;
  padding: 24px;
  gap: 14px;
  overflow-y: auto;
`

const PanelTitle = styled.div`
  font-size: 28px;
  font-weight: 700;
  color: #eee;
  border-bottom: 1px solid #444;
  padding-bottom: 12px;
`

const MemberItem = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 10px;
  background: #2a2a2a;
  font-size: 22px;
`

const GreenDot = styled.span`
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #42a55a;
  flex-shrink: 0;
`

const HandBadge = styled.div`
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: #f5a623;
  color: #000;
  font-size: 22px;
  font-weight: 700;
  padding: 8px 24px;
  border-radius: 24px;
  z-index: 100;
  pointer-events: none;
`

// ─── Storage ─────────────────────────────────────────────────────────────────

interface VideoState {
  isAudioMuted: boolean
  isVideoOff: boolean
  isSharingScreen: boolean
  hasStream: boolean
}

function getWebRTC() {
  const game = phaserGame.scene.keys.game as Game
  return game?.network?.webRTC
}

function getNetwork() {
  const game = phaserGame.scene.keys.game as Game
  return game?.network
}

// ─── ドキュメントエディタ ────────────────────────────────────────────────────

function DocumentEditor({ roomId }: { roomId: string }) {
  const storageKey = `${DOC_STORAGE_PREFIX}${roomId}`
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [content, setContent] = useState(() => {
    try { return localStorage.getItem(storageKey) || '' } catch { return '' }
  })

  const sendTimer = useRef<number>()
  const pendingContent = useRef<string | null>(null)

  const flushSync = useCallback(() => {
    if (sendTimer.current) {
      window.clearTimeout(sendTimer.current)
      sendTimer.current = undefined
    }
    if (pendingContent.current !== null) {
      getNetwork()?.sendMeetingDocUpdate(roomId, pendingContent.current)
      pendingContent.current = null
    }
  }, [roomId])

  const scheduleSync = (val: string) => {
    pendingContent.current = val
    if (sendTimer.current) return
    sendTimer.current = window.setTimeout(() => {
      if (pendingContent.current !== null) getNetwork()?.sendMeetingDocUpdate(roomId, pendingContent.current)
      pendingContent.current = null
      sendTimer.current = undefined
    }, 300)
  }

  useEffect(() => {
    const handler = (remoteRoomId: string, remoteContent: string) => {
      if (remoteRoomId !== roomId) return
      // 自分が入力中（フォーカス中）のときはリモート更新で上書きしない
      if (document.activeElement === taRef.current) return
      setContent(remoteContent)
      try { localStorage.setItem(storageKey, remoteContent) } catch {}
    }
    phaserEvents.on(PhaserEvent.MEETING_DOC_REMOTE_UPDATE, handler)
    getNetwork()?.requestMeetingDocSnapshot(roomId)
    return () => {
      phaserEvents.off(PhaserEvent.MEETING_DOC_REMOTE_UPDATE, handler)
      flushSync()
    }
  }, [roomId, storageKey, flushSync])

  const save = (val: string) => {
    setContent(val)
    try { localStorage.setItem(storageKey, val) } catch {}
    scheduleSync(val)
  }

  const insertLinePrefix = (prefix: string) => {
    const ta = taRef.current
    if (!ta) return
    const { selectionStart: s, value } = ta
    const lineStart = value.lastIndexOf('\n', s - 1) + 1
    const newVal = value.slice(0, lineStart) + prefix + value.slice(lineStart)
    save(newVal)
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = s + prefix.length; ta.focus() }, 0)
  }

  const insertAround = (pre: string, suf = '') => {
    const ta = taRef.current
    if (!ta) return
    const { selectionStart: s, selectionEnd: e, value } = ta
    const newVal = value.slice(0, s) + pre + value.slice(s, e) + suf + value.slice(e)
    save(newVal)
    setTimeout(() => { ta.selectionStart = s + pre.length; ta.selectionEnd = e + pre.length; ta.focus() }, 0)
  }

  return (
    <>
      <DocScrollArea>
        <DocTextArea
          ref={taRef}
          value={content}
          onChange={(e) => save(e.target.value)}
          onBlur={flushSync}
          placeholder={'ここにメモや議事録を入力...\n\n例：\n○議題タイトル\n　内容や決定事項をここに書く\n\n■アクションアイテム\n　担当者・期限を記入'}
          spellCheck={false}
        />
      </DocScrollArea>
      <DocToolbar>
        <DocBtn title="大見出し" onClick={() => insertLinePrefix('# ')}>H1</DocBtn>
        <DocBtn title="中見出し" onClick={() => insertLinePrefix('## ')}>H2</DocBtn>
        <DocBtn title="小見出し" onClick={() => insertLinePrefix('### ')}>H3</DocBtn>
        <DocSep />
        <DocBtn title="箇条書き" onClick={() => insertLinePrefix('・')}>・リスト</DocBtn>
        <DocBtn title="チェック" onClick={() => insertLinePrefix('☐ ')}>☐</DocBtn>
        <DocSep />
        <DocBtn title="太字【】" onClick={() => insertAround('【', '】')}>太字</DocBtn>
        <DocBtn title="区切り線" onClick={() => insertAround('\n──────────\n')}>――</DocBtn>
        <DocSep />
        <DocBtn title="全削除" style={{ color: '#c44' }} onClick={() => { if (window.confirm('ドキュメントをすべて削除しますか？')) save('') }}>消去</DocBtn>
      </DocToolbar>
    </>
  )
}

// ─── ビューモード付きホワイトボード ─────────────────────────────────────────

function WhiteboardWithDoc({ roomId }: { roomId: string }) {
  const [tabs, setTabs] = useState<WBTab[]>(() => loadTabs(roomId))
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0]?.id ?? 'tab_default')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  // 他の人がタブを切り替えたことを一時的に知らせる通知（「◯◯さんが議題2に切り替えました」）
  const [switchNotice, setSwitchNotice] = useState<string | null>(null)
  const switchNoticeTimer = useRef<number>()

  const [docWidth, setDocWidth] = useState(420)
  const dragging = useRef(false)
  const startX   = useRef(0)
  const startW   = useRef(0)
  const handleRef = useRef<HTMLDivElement>(null)
  const splitRef  = useRef<HTMLDivElement>(null)

  const persistTabs = useCallback((next: WBTab[]) => {
    setTabs(next)
    saveTabs(roomId, next)
    getNetwork()?.sendMeetingTabsUpdate(roomId, next)
  }, [roomId])

  useEffect(() => {
    const handler = (remoteRoomId: string, remoteTabs: WBTab[]) => {
      if (remoteRoomId !== roomId) return
      // タブ名編集中は上書きしない
      if (editingId) return
      if (!Array.isArray(remoteTabs) || remoteTabs.length === 0) return
      setTabs(remoteTabs)
      saveTabs(roomId, remoteTabs)
      setActiveTabId((prev) => (remoteTabs.some((t) => t.id === prev) ? prev : remoteTabs[0].id))
    }
    phaserEvents.on(PhaserEvent.MEETING_TABS_REMOTE_UPDATE, handler)
    getNetwork()?.requestMeetingTabsSnapshot(roomId)
    return () => {
      phaserEvents.off(PhaserEvent.MEETING_TABS_REMOTE_UPDATE, handler)
    }
  }, [roomId, editingId])

  // 「今みんなが見ているタブ」をサーバーに送る（自分の操作による切り替え時に呼ぶ）
  const switchTab = useCallback((id: string) => {
    setActiveTabId(id)
    getNetwork()?.sendMeetingActiveTabUpdate(roomId, id)
  }, [roomId])

  // 他の人のタブ切り替えを受信し、自分の画面も追従させる
  useEffect(() => {
    const handler = (remoteRoomId: string, tabId: string, byName: string) => {
      if (remoteRoomId !== roomId || !tabId) return
      setActiveTabId(tabId)
      if (byName) {
        const tabName = tabs.find((t) => t.id === tabId)?.name || tabId
        setSwitchNotice(`${byName}さんが${tabName}に切り替えました`)
        if (switchNoticeTimer.current) window.clearTimeout(switchNoticeTimer.current)
        switchNoticeTimer.current = window.setTimeout(() => setSwitchNotice(null), 2500)
      }
    }
    phaserEvents.on(PhaserEvent.MEETING_ACTIVE_TAB_REMOTE_UPDATE, handler)
    getNetwork()?.requestMeetingActiveTab(roomId)
    return () => {
      phaserEvents.off(PhaserEvent.MEETING_ACTIVE_TAB_REMOTE_UPDATE, handler)
      if (switchNoticeTimer.current) window.clearTimeout(switchNoticeTimer.current)
    }
  }, [roomId, tabs])

  const addTab = () => {
    const id = `tab_${Date.now()}`
    const name = `議題${tabs.length + 1}`
    const color = TAB_COLORS[tabs.length % TAB_COLORS.length]
    const next = [...tabs, { id, name, color }]
    persistTabs(next)
    switchTab(id)
  }

  const removeTab = (id: string) => {
    if (tabs.length <= 1) return
    const next = tabs.filter((t) => t.id !== id)
    persistTabs(next)
    if (activeTabId === id) switchTab(next[0].id)
  }

  const startEdit = (tab: WBTab) => {
    setEditingId(tab.id)
    setEditName(tab.name)
  }

  const commitEdit = () => {
    if (!editingId) return
    const trimmed = editName.trim() || tabs.find((t) => t.id === editingId)?.name || ''
    persistTabs(tabs.map((t) => (t.id === editingId ? { ...t, name: trimmed } : t)))
    setEditingId(null)
  }

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current   = e.clientX
    startW.current   = docWidth
    handleRef.current?.classList.add('dragging')

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !splitRef.current) return
      const totalW  = splitRef.current.getBoundingClientRect().width
      const delta   = ev.clientX - startX.current
      const next    = Math.min(Math.max(startW.current + delta, 300), totalW - 200)
      setDocWidth(next)
    }
    const onUp = () => {
      dragging.current = false
      handleRef.current?.classList.remove('dragging')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const docRoomId = activeTab.id === 'tab_default' ? roomId : `${roomId}__${activeTab.id}`

  return (
    <>
      {switchNotice && <SwitchNoticeBar>{switchNotice}</SwitchNoticeBar>}
      <TabBarWrap>
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            active={tab.id === activeTabId}
            $tabColor={tab.color}
            onClick={() => { if (editingId !== tab.id) switchTab(tab.id) }}
            onDoubleClick={() => startEdit(tab)}
          >
            {editingId === tab.id ? (
              <TabInput
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => { if (e.key === 'Enter') commitEdit() }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span>{tab.name}</span>
            )}
            {tabs.length > 1 && (
              <TabCloseBtn
                onClick={(e) => { e.stopPropagation(); removeTab(tab.id) }}
                title="タブを閉じる"
              >
                ×
              </TabCloseBtn>
            )}
          </TabItem>
        ))}
        <AddTabBtn onClick={addTab} title="タブを追加">＋</AddTabBtn>
      </TabBarWrap>
      <ContentSplit ref={splitRef}>
        <DocPane style={{ width: docWidth }}>
          <DocumentEditor key={`doc_${activeTab.id}`} roomId={docRoomId} />
        </DocPane>
        <ResizeHandle ref={handleRef} onMouseDown={onMouseDown} />
        <CanvasPanel>
          <CollaborativeWhiteboard key={`wb_${activeTab.id}`} roomId={`${roomId}__${activeTab.id}`} />
        </CanvasPanel>
      </ContentSplit>
    </>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function MeetingRoomOverlay() {
  const dispatch = useAppDispatch()
  const activeRoom = useAppSelector((state) => state.meetingRoom.activeRoom)
  const playerNameMap = useAppSelector((state) => state.user.playerNameMap)
  const sessionId = useAppSelector((state) => state.user.sessionId)
  const myPlayerName = useAppSelector((state) => state.user.playerName) || 'あなた'
  const myAvatarName = useAppSelector((state) => state.user.avatarName) || 'adam'
  const videoConnected = useAppSelector((state) => state.user.videoConnected)
  const playerHandRaisedMap = useAppSelector((state) => state.user.playerHandRaisedMap)
  const playerMeetingRoomMap = useAppSelector((state) => state.user.playerMeetingRoomMap)
  const playerAudioMutedMap = useAppSelector((state) => state.user.playerAudioMutedMap)
  const playerScreenSharingMap = useAppSelector((state) => state.user.playerScreenSharingMap)

  const peerContainerRef = useRef<HTMLDivElement>(null)
  const screenShareContainerRef = useRef<HTMLDivElement>(null)
  const [videoState, setVideoState] = useState<VideoState>({
    isAudioMuted: false, isVideoOff: false, isSharingScreen: false, hasStream: false,
  })
  const [handRaised, setHandRaised] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [showScreenShareView, setShowScreenShareView] = useState(false)

  useEffect(() => {
    const rtc = getWebRTC()
    if (rtc) {
      setVideoState({
        isAudioMuted: rtc.isAudioMuted,
        isVideoOff: rtc.isVideoOff,
        isSharingScreen: rtc.isSharingScreen,
        hasStream: !!rtc.myStream,
      })
    }
  }, [])

  useEffect(() => {
    const handler = (e: globalThis.Event) => setVideoState((e as CustomEvent).detail as VideoState)
    window.addEventListener('webrtc-state-change', handler)
    return () => window.removeEventListener('webrtc-state-change', handler)
  }, [])

  // activeRoom が存在するときだけビデオをマウント
  useEffect(() => {
    if (!activeRoom) return
    // DOM が描画されてから少し待ってマウント（hasStream が変わった時も再アタッチ）
    const timer = setTimeout(() => {
      getWebRTC()?.attachLocalVideo('meeting-my-video-mount')
      if (peerContainerRef.current) getWebRTC()?.mountPeerVideos(peerContainerRef.current)
    }, 100)
    return () => clearTimeout(timer)
  }, [activeRoom, videoConnected, videoState.isVideoOff, videoState.hasStream])

  // 入室後に新しく接続したピアの映像も自動的にこのコンテナへ追加されるよう、
  // マウント先としてWebRTCに登録する（以前はwebrtc-video-sourceをMutationObserverで監視していた）
  useEffect(() => {
    if (!activeRoom) return
    const peerTarget = peerContainerRef.current
    if (!peerTarget) return
    getWebRTC()?.mountPeerVideos(peerTarget)
    return () => {
      getWebRTC()?.unmountPeerVideos(peerTarget)
    }
  }, [activeRoom, videoConnected])

  // 相手のカメラカードに挙手バッジを表示（WebRTCがDOMを直接構築しているため直接操作する）
  useEffect(() => {
    const container = peerContainerRef.current
    if (!container) return
    const wrappers = container.querySelectorAll<HTMLDivElement>('.peer-video-wrapper[data-session-id]')
    wrappers.forEach((wrapper) => {
      const peerSessionId = wrapper.dataset.sessionId
      const raised = !!(peerSessionId && playerHandRaisedMap.get(peerSessionId))
      let badge = wrapper.querySelector<HTMLDivElement>('.peer-hand-badge')
      if (raised) {
        if (!badge) {
          badge = document.createElement('div')
          badge.className = 'peer-hand-badge'
          badge.innerText = '✋'
          badge.style.position = 'absolute'
          badge.style.top = '8px'
          badge.style.left = '10px'
          badge.style.fontSize = '22px'
          badge.style.zIndex = '10'
          badge.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))'
          wrapper.appendChild(badge)
        }
      } else if (badge) {
        badge.remove()
      }
    })
  }, [playerHandRaisedMap, activeRoom])

  // この会議室に入室中の他プレイヤーのみを参加者として扱う（オフィス全体の人数ではない）
  const otherMembersInRoom = activeRoom
    ? Array.from(playerNameMap.entries()).filter(
        ([memberSessionId]) => playerMeetingRoomMap.get(memberSessionId) === activeRoom.id
      )
    : []

  // 会議室内で画面共有中の相手（自分以外）
  const remoteScreenSharerId = otherMembersInRoom.find(([sid]) => playerScreenSharingMap.get(sid))?.[0] ?? null
  const remoteScreenSharerName = remoteScreenSharerId ? (playerNameMap.get(remoteScreenSharerId) || '相手') : null
  const isSomeoneSharing = !!remoteScreenSharerId || videoState.isSharingScreen

  // 誰かが共有を始めたら自動で共有画面ビューに切り替え、共有が終わったらホワイトボードへ戻す
  useEffect(() => {
    setShowScreenShareView(isSomeoneSharing)
  }, [isSomeoneSharing])

  // 相手の共有画面を大きな表示エリアへ移動する（既存のピア映像要素をreparentするだけ）
  useEffect(() => {
    if (!remoteScreenSharerId || !showScreenShareView) return
    const container = screenShareContainerRef.current
    if (!container) return
    getWebRTC()?.mountScreenShareVideo(remoteScreenSharerId, container)
    return () => {
      getWebRTC()?.unmountScreenShareVideo(remoteScreenSharerId)
    }
  }, [remoteScreenSharerId, showScreenShareView])

  // 自分が共有中のときは自分の画面プレビューを表示する
  useEffect(() => {
    if (!videoState.isSharingScreen || !showScreenShareView || remoteScreenSharerId) return
    getWebRTC()?.attachLocalScreenPreview('meeting-screen-share-self-mount')
  }, [videoState.isSharingScreen, showScreenShareView, remoteScreenSharerId])

  if (!activeRoom) return null

  const myName = myPlayerName
  const members = [[sessionId, myName] as [string, string], ...otherMembersInRoom]

  const leaveRoom = () => {
    setHandRaised(false)
    dispatch(clearActiveMeetingRoom())
    phaserEvents.emit(PhaserEvent.MEETING_ROOM_EXIT)
  }

  const toggleMic    = () => getWebRTC()?.toggleMute()
  const toggleVideo  = () => getWebRTC()?.toggleVideo()
  const toggleScreen = () => {
    const rtc = getWebRTC()
    if (!rtc) return
    rtc.isSharingScreen ? rtc.stopScreenShare() : rtc.startScreenShare()
  }

  return (
    <>
    <ExcalidrawGlobal />
    <Shell>
      {handRaised && <HandBadge>✋ 手を挙げています</HandBadge>}

      {/* 左上：ドキュメント＋ホワイトボード、または共有画面 */}
      <WhiteboardArea>
        {isSomeoneSharing && (
          <ScreenShareToggleBar>
            <ScreenShareToggleBtn active={!showScreenShareView} onClick={() => setShowScreenShareView(false)}>
              ホワイトボード
            </ScreenShareToggleBtn>
            <ScreenShareToggleBtn active={showScreenShareView} onClick={() => setShowScreenShareView(true)}>
              🖥️ 共有画面（{remoteScreenSharerName || '自分'}）
            </ScreenShareToggleBtn>
          </ScreenShareToggleBar>
        )}
        {showScreenShareView ? (
          <ScreenShareView>
            {remoteScreenSharerId ? (
              <div ref={screenShareContainerRef} style={{ width: '100%', height: '100%' }} />
            ) : (
              <div id="meeting-screen-share-self-mount" style={{ width: '100%', height: '100%' }} />
            )}
          </ScreenShareView>
        ) : (
          <WhiteboardWithDoc roomId={activeRoom.id} />
        )}
      </WhiteboardArea>

      {/* 右上：カメラ列（縦積み） */}
      <CameraColumn>
        {/* 自分のカメラ */}
        <CamCard>
          {/* 常にDOM上に置いてWebRTCがアタッチできるようにする。映像が来たら表示 */}
          <div
            id="meeting-my-video-mount"
            style={{
              width: '100%', height: '100%',
              display: (videoConnected && !videoState.isVideoOff && videoState.hasStream) ? 'block' : 'none',
            }}
          />
          {/* カメラOFF・未接続・ストリーム待ちの間はアバターを表示 */}
          {(!videoConnected || videoState.isVideoOff || !videoState.hasStream) && (
            <AvatarFallback $bgGradient={getGradient(sessionId || myName)}>
              <img src={avatarMap[myAvatarName]} alt={myAvatarName} />
            </AvatarFallback>
          )}
          <div className="cam-label">
            {(!videoConnected || videoState.isAudioMuted) ? '🔇 ' : ''}{myName}（自分）
          </div>
        </CamCard>

        {/* 他者のカメラ（WebRTCが動的に追加） */}
        <PeerVideosColumn ref={peerContainerRef} />
      </CameraColumn>

      {/* 参加者パネル */}
      <MembersPanel open={showMembers}>
        <PanelTitle>参加者 ({members.length}人)</PanelTitle>
        {members.map(([memberSessionId, name]) => {
          const isMe = memberSessionId === sessionId
          const isMuted = isMe ? videoState.isAudioMuted : !!playerAudioMutedMap.get(memberSessionId)
          const isHandRaised = isMe ? handRaised : !!playerHandRaisedMap.get(memberSessionId)
          return (
            <MemberItem key={memberSessionId}>
              <GreenDot />
              {isMuted && '🔇 '}
              {name}
              {isMe && '（自分）'}
              {isHandRaised && ' ✋'}
            </MemberItem>
          )
        })}
      </MembersPanel>

      {/* 下部コントロールバー */}
      <BottomBar>
        {/* マイク・カメラ・画面共有 */}
        <BarGroup>
          {videoConnected ? (
            <>
              <Tooltip title={videoState.isAudioMuted ? 'ミュート解除' : 'ミュート'}>
                <CtrlBtn isOff={videoState.isAudioMuted} onClick={toggleMic}>
                  {videoState.isAudioMuted ? <MicOffIcon /> : <MicIcon />}
                  <span className="clabel">{videoState.isAudioMuted ? 'ミュート解除' : 'ミュート'}</span>
                </CtrlBtn>
              </Tooltip>
              <Tooltip title={videoState.isVideoOff ? 'カメラON' : 'カメラOFF'}>
                <CtrlBtn isOff={videoState.isVideoOff} onClick={toggleVideo}>
                  {videoState.isVideoOff ? <VideocamOffIcon /> : <VideocamIcon />}
                  <span className="clabel">{videoState.isVideoOff ? 'ビデオ開始' : 'ビデオ停止'}</span>
                </CtrlBtn>
              </Tooltip>
              <Tooltip title={videoState.isSharingScreen ? '共有停止' : '画面共有'}>
                <CtrlBtn isOff={videoState.isSharingScreen} onClick={toggleScreen}>
                  {videoState.isSharingScreen ? <StopScreenShareIcon /> : <ScreenShareIcon />}
                  <span className="clabel">画面共有</span>
                </CtrlBtn>
              </Tooltip>
            </>
          ) : (
            <span style={{ color: '#666', fontSize: 22 }}>カメラ未接続</span>
          )}
        </BarGroup>

        {/* 手を挙げる・参加者 */}
        <BarGroup>
          <Tooltip title={handRaised ? '手を下ろす' : '手を挙げる'}>
            <CtrlBtn
              isOff={handRaised}
              onClick={() => {
                const next = !handRaised
                setHandRaised(next)
                getNetwork()?.raiseHand(next)
              }}
            >
              <PanToolIcon />
              <span className="clabel">手を挙げる</span>
            </CtrlBtn>
          </Tooltip>
          <Tooltip title="参加者">
            <CtrlBtn isOff={showMembers} onClick={() => setShowMembers((v) => !v)}>
              <PeopleIcon />
              <span className="clabel">参加者</span>
            </CtrlBtn>
          </Tooltip>
        </BarGroup>

        {/* 退出 */}
        <BarGroup>
          <ExitBtn onClick={leaveRoom}>
            <ExitToAppIcon />
            <span className="clabel">退出</span>
          </ExitBtn>
        </BarGroup>
      </BottomBar>
    </Shell>
    </>
  )
}
