import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled, { createGlobalStyle } from 'styled-components'
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
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'

import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'
import { useAppDispatch, useAppSelector } from '../hooks'
import { clearActiveMeetingRoom } from '../stores/MeetingRoomStore'
import { phaserEvents, Event as PhaserEvent } from '../events/EventCenter'

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
`

/* ── Excalidraw ツールバーをグローバルに上書き ─────────────────────────────── */
const ExcalidrawGlobal = createGlobalStyle`
  /* テーマカラー & ボタンサイズ（縦並びでも大きめに。溢れたらスクロール） */
  .excalidraw {
    --color-primary: #926f45 !important;
    --color-primary-darker: #684d2e !important;
    --color-primary-darkest: #4c3722 !important;
    --color-primary-light: #f4e2c2 !important;
    --default-button-size: 3.5rem !important;
    --default-icon-size: 2rem !important;
    --lg-button-size: 3.5rem !important;
    --lg-icon-size: 2rem !important;
    --space-factor: 0.4rem !important;
  }

  /* アイコンサイズ */
  .excalidraw .ToolIcon__icon svg,
  .excalidraw .App-toolbar svg {
    width: 1.9rem !important;
    height: 1.9rem !important;
  }

  /* ズーム/Undo・Redo・ライブラリ等のUIも拡大 */
  .excalidraw .zoom-actions,
  .excalidraw .undo-redo-buttons,
  .excalidraw .App-menu_bottom {
    font-size: 1.2rem !important;
  }

  /* ===== メインツールバー（図形ツール）を左端・縦中央に ====================
     図形ツールは画面幅に関わらず常に .App-toolbar > .Stack_horizontal（既定は
     上部の横並び grid）に描画される。これを縦並びにし、入れ物を左端へ寄せる。
     Excalidraw はキャンバスサイズで2レイアウトに切り替わり、左寄せの基準となる
     入れ物クラスが異なる：
       ・広幅 → デスクトップ: section.shapes-section
       ・狭幅 → モバイル:     .App-toolbar--mobile
     どちらも全キャンバスを覆う .FixedSideContainer を基準に絶対配置するため、
     メモ幅を変えてキャンバス左端が動くとツールバーも追従する。 */

  .excalidraw .shapes-section,
  .excalidraw .App-toolbar--mobile {
    position: absolute !important;
    left: 8px !important;
    top: 50% !important;
    transform: translateY(-50%) !important;
    width: auto !important;
    height: auto !important;
    max-height: calc(100% - 16px) !important;
    overflow-y: auto !important;
    overflow-x: hidden !important;
    z-index: 5 !important;
  }

  /* ボタンの横並び grid を縦並びに */
  .excalidraw .App-toolbar > .Stack.Stack_horizontal {
    grid-auto-flow: row !important;
    grid-template-columns: auto !important;
    grid-template-rows: none !important;
    justify-items: center !important;
  }
  .excalidraw .App-toolbar {
    width: auto !important;
  }

  /* ツールバー内のヒント文は縦並びだと位置が崩れるため非表示 */
  .excalidraw .App-toolbar .HintViewer {
    display: none !important;
  }

  /* 区切り線を縦→横に変換 */
  .excalidraw .App-toolbar__divider {
    width: 70% !important;
    height: 1px !important;
    margin: 4px auto !important;
    align-self: center !important;
  }

  /* 図形/テキストのプロパティパネル（線・塗り・線の太さ・フォントサイズ等）は
     既定で左側に出てツールバーと重なるため、右側へ移動して両方使えるようにする。
     ※モバイルではこのパネルは出ず、下部バーのパレットから開くので影響なし。 */
  .excalidraw .App-menu__left {
    left: auto !important;
    right: 8px !important;
    max-height: calc(100% - 16px) !important;
    overflow-y: auto !important;
  }

  /* 「ライブラリ」ボタンは社内ホワイトボードでは使わないため非表示 */
  .excalidraw .default-sidebar-trigger,
  .excalidraw .sidebar-trigger {
    display: none !important;
  }

  /* ズーム＋元に戻す/やり直しは、既定の左下だと左端の縦ツールバーと重なるため
     下部中央へ移動する。 */
  .excalidraw .layer-ui__wrapper__footer-left {
    position: absolute !important;
    left: 50% !important;
    bottom: 0 !important;
    transform: translateX(-50%) !important;
  }
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
  display: contents;   /* 子の video を CameraColumn の直接 flex 子として扱う */

  video {
    width: ${CAM_W}px;
    height: ${CAM_H}px;
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

const STORAGE_PREFIX = 'skyoffice_meeting_whiteboard_'

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

// ─── Collaborative Whiteboard ─────────────────────────────────────────────────

// ─── ドキュメントエディタ ────────────────────────────────────────────────────

function DocumentEditor({ roomId }: { roomId: string }) {
  const storageKey = `${DOC_STORAGE_PREFIX}${roomId}`
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [content, setContent] = useState(() => {
    try { return localStorage.getItem(storageKey) || '' } catch { return '' }
  })

  const save = (val: string) => {
    setContent(val)
    try { localStorage.setItem(storageKey, val) } catch {}
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

  const [docWidth, setDocWidth] = useState(420)
  const dragging = useRef(false)
  const startX   = useRef(0)
  const startW   = useRef(0)
  const handleRef = useRef<HTMLDivElement>(null)
  const splitRef  = useRef<HTMLDivElement>(null)

  const persistTabs = useCallback((next: WBTab[]) => {
    setTabs(next)
    saveTabs(roomId, next)
  }, [roomId])

  const addTab = () => {
    const id = `tab_${Date.now()}`
    const name = `議題${tabs.length + 1}`
    const color = TAB_COLORS[tabs.length % TAB_COLORS.length]
    const next = [...tabs, { id, name, color }]
    persistTabs(next)
    setActiveTabId(id)
  }

  const removeTab = (id: string) => {
    if (tabs.length <= 1) return
    const next = tabs.filter((t) => t.id !== id)
    persistTabs(next)
    if (activeTabId === id) setActiveTabId(next[0].id)
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
      <TabBarWrap>
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            active={tab.id === activeTabId}
            $tabColor={tab.color}
            onClick={() => { if (editingId !== tab.id) setActiveTabId(tab.id) }}
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

// ─── 単一ホワイトボード ───────────────────────────────────────────────────────

function CollaborativeWhiteboard({ roomId }: { roomId: string }) {
  const apiRef = useRef<any>(null)
  const applyingRemote = useRef(false)
  const pendingPayload = useRef<any>(null)
  const sendTimer = useRef<number>()
  const storageKey = `${STORAGE_PREFIX}${roomId}`

  // 画像ファイルを累積管理
  const filesRef = useRef<Record<string, any>>({})

  const initialData = useMemo(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed.files && typeof parsed.files === 'object') {
          filesRef.current = { ...parsed.files }
        }
        return parsed
      }
    } catch {}
    return { elements: [], appState: { viewBackgroundColor: '#fffaf0' }, files: {} }
  }, [storageKey])

  useEffect(() => {
    const handler = (remoteRoomId: string, payload: any) => {
      if (remoteRoomId !== roomId || !apiRef.current) return
      applyingRemote.current = true
      if (payload.files && typeof payload.files === 'object') {
        filesRef.current = { ...filesRef.current, ...payload.files }
      }
      apiRef.current.updateScene({
        elements: payload.elements || [],
        appState: payload.appState || {},
        files: filesRef.current,
      })
      try { localStorage.setItem(storageKey, JSON.stringify({ ...payload, files: filesRef.current })) } catch {}
      window.requestAnimationFrame(() => { applyingRemote.current = false })
    }
    phaserEvents.on(PhaserEvent.MEETING_WHITEBOARD_REMOTE_UPDATE, handler)
    getNetwork()?.requestMeetingWhiteboardSnapshot(roomId)
    return () => {
      phaserEvents.off(PhaserEvent.MEETING_WHITEBOARD_REMOTE_UPDATE, handler)
      if (sendTimer.current) window.clearTimeout(sendTimer.current)
    }
  }, [roomId, storageKey])

  const scheduleSync = (payload: any) => {
    pendingPayload.current = payload
    if (sendTimer.current) return
    sendTimer.current = window.setTimeout(() => {
      if (pendingPayload.current) getNetwork()?.sendMeetingWhiteboardUpdate(roomId, pendingPayload.current)
      pendingPayload.current = null
      sendTimer.current = undefined
    }, 160)
  }

  const handleChange = (elements: readonly any[], appState: any, newFiles: any) => {
    if (applyingRemote.current) return
    if (newFiles && typeof newFiles === 'object' && Object.keys(newFiles).length > 0) {
      filesRef.current = { ...filesRef.current, ...newFiles }
    }
    const payload = {
      elements,
      appState: { viewBackgroundColor: appState.viewBackgroundColor, theme: appState.theme, gridSize: appState.gridSize },
      files: filesRef.current,
      updatedAt: Date.now(),
    }
    try { localStorage.setItem(storageKey, JSON.stringify(payload)) } catch {}
    scheduleSync(payload)
  }

  return (
    <Excalidraw
      initialData={initialData}
      excalidrawAPI={(api) => {
        apiRef.current = api
      }}
      onChange={handleChange}
      UIOptions={{
        tools: { image: true },
        canvasActions: {
          saveAsImage: true,
          export: { saveFileToDisk: true },
          loadScene: true,
          saveToActiveFile: true,
        },
      }}
      langCode="ja-JP"
    />
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

  const peerContainerRef = useRef<HTMLDivElement>(null)
  const [videoState, setVideoState] = useState<VideoState>({
    isAudioMuted: false, isVideoOff: false, isSharingScreen: false, hasStream: false,
  })
  const [handRaised, setHandRaised] = useState(false)
  const [showMembers, setShowMembers] = useState(false)

  useEffect(() => {
    const handler = (e: globalThis.Event) => setVideoState((e as CustomEvent).detail as VideoState)
    window.addEventListener('webrtc-state-change', handler)
    return () => window.removeEventListener('webrtc-state-change', handler)
  }, [])

  // activeRoom が存在するときだけビデオをマウント
  useEffect(() => {
    if (!activeRoom) return
    // DOM が描画されてから少し待ってマウント
    const timer = setTimeout(() => {
      getWebRTC()?.attachLocalVideo('meeting-my-video-mount')
      if (peerContainerRef.current) getWebRTC()?.mountPeerVideos(peerContainerRef.current)
    }, 100)
    return () => clearTimeout(timer)
  }, [activeRoom, videoConnected, videoState.isVideoOff])

  if (!activeRoom) return null

  const myName = myPlayerName
  const members = Array.from(playerNameMap.values())

  const leaveRoom = () => {
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

      {/* 左上：ドキュメント＋ホワイトボード */}
      <WhiteboardArea>
        <WhiteboardWithDoc roomId={activeRoom.id} />
      </WhiteboardArea>

      {/* 右上：カメラ列（縦積み） */}
      <CameraColumn>
        {/* 自分のカメラ */}
        {videoConnected && (
          <CamCard>
            {videoState.isVideoOff
              ? <AvatarFallback $bgGradient={getGradient(sessionId || myName)}><img src={avatarMap[myAvatarName]} alt={myAvatarName} /></AvatarFallback>
              : <div id="meeting-my-video-mount" style={{ width: '100%', height: '100%' }} />
            }
            <div className="cam-label">
              {videoState.isAudioMuted ? '🔇 ' : ''}{myName}（自分）
            </div>
          </CamCard>
        )}

        {/* 他者のカメラ（WebRTCが動的に追加） */}
        <PeerVideosColumn ref={peerContainerRef} />
      </CameraColumn>

      {/* 参加者パネル */}
      <MembersPanel open={showMembers}>
        <PanelTitle>参加者 ({members.length}人)</PanelTitle>
        {members.map((name) => (
          <MemberItem key={name}>
            <GreenDot />
            {name}
          </MemberItem>
        ))}
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
            <CtrlBtn isOff={handRaised} onClick={() => setHandRaised((v) => !v)}>
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
