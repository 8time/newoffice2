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
import LazyWhiteboard from './LazyWhiteboard'

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

// ─── メモ欄とキャンバスの境目の位置 ───────────────────────────────────────────
// 毎回同じ位置に調整し直すのは手間なので、ブラウザに覚えさせる。
// 見え方の好みは人ごと・画面ごとに違うため、全員で共有はせず自分の端末だけに保存する。

const DOC_WIDTH_KEY = 'skyoffice_meeting_doc_width'
const DOC_WIDTH_DEFAULT = 420

function loadDocWidth(): number {
  try {
    const saved = Number(localStorage.getItem(DOC_WIDTH_KEY))
    // 画面幅は環境で変わるため、極端な値で復元して操作不能にならないようにする
    if (Number.isFinite(saved) && saved >= 300 && saved <= 2000) return saved
  } catch {}
  return DOC_WIDTH_DEFAULT
}

function saveDocWidth(width: number) {
  try { localStorage.setItem(DOC_WIDTH_KEY, String(Math.round(width))) } catch {}
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

const DocEditable = styled.div`
  display: block;
  width: 100%;
  min-height: 100%;
  box-sizing: border-box;
  border: none;
  outline: none;
  padding: 40px 36px;
  font-size: 30px;
  line-height: 1.9;
  font-family: 'Noto Sans JP', 'Hiragino Kaku Gothic Pro', 'Yu Gothic', sans-serif;
  color: #1a1a1a;
  background: #fff;
  overflow-wrap: break-word;

  &:empty::before {
    content: attr(data-placeholder);
    color: #b7b0a4;
    white-space: pre-wrap;
  }

  h1 { font-size: 1.5em; margin: 0.6em 0 0.3em; }
  h2 { font-size: 1.3em; margin: 0.6em 0 0.3em; }
  h3 { font-size: 1.15em; margin: 0.6em 0 0.3em; }
  h4 { font-size: 1.05em; margin: 0.6em 0 0.3em; }
  ul, ol { padding-left: 1.4em; margin: 0.3em 0; }
  blockquote {
    margin: 0.4em 0;
    padding-left: 0.8em;
    border-left: 4px solid #d8d2c4;
    color: #666;
  }
  code {
    background: #f0ece3;
    border-radius: 4px;
    padding: 0.1em 0.3em;
    font-family: monospace;
    font-size: 0.9em;
  }
  hr { border: none; border-top: 2px solid #ddd6c8; margin: 0.8em 0; }

  /* チェックリスト。行頭の記号をクリックで済/未を切り替える */
  ul[data-check] {
    list-style: none;
    padding-left: 0.3em;
  }
  ul[data-check] > li::before {
    content: '☐';
    display: inline-block;
    width: 1.3em;
    cursor: pointer;
    color: #777;
  }
  ul[data-check] > li[data-done='1'] {
    color: #999;
    text-decoration: line-through;
  }
  ul[data-check] > li[data-done='1']::before {
    content: '☑';
    color: #2e9e5b;
  }
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

// ＋ と T の押下で開くメニュー。ツールバーは下端にあるので上向きに開く
const DocMenuWrap = styled.div`
  position: relative;
`

const DocMenu = styled.div`
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 6px;
  background: #fff;
  border: 1px solid #d4cdc0;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  padding: 6px;
  z-index: 50;
  min-width: 190px;
`

const DocMenuItem = styled.button`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: none;
  background: transparent;
  color: #333;
  font-size: 15px;
  text-align: left;
  padding: 9px 12px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;

  .k {
    min-width: 30px;
    color: #888;
    font-size: 13px;
  }
  &:hover { background: rgba(0, 0, 0, 0.07); }
`

// 太字などの装飾は横に並べる
const DocMenuRow = styled.div`
  display: flex;
  gap: 4px;
  padding: 4px 6px 2px;
  border-top: 1px solid #ece7dd;
  margin-top: 4px;
`

const DocMenuIconBtn = styled.button`
  width: 40px;
  height: 36px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 16px;
  color: #333;
  &:hover { background: rgba(0, 0, 0, 0.07); }
`

// 文字色の見本。押すと選択中の文字がその色になる
const ColorDot = styled.button<{ $color: string }>`
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid rgba(0, 0, 0, 0.15);
  background: ${(p) => p.$color};
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;

  &:hover {
    transform: scale(1.15);
    border-color: rgba(0, 0, 0, 0.45);
  }
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

// メニューの「▾」
const Caret = styled.span`
  font-size: 13px;
  margin-left: 3px;
  color: #999;
`

const todayLabel = () => {
  const d = new Date()
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

// 文字色に使う色。増やしすぎると選ぶのが手間なので、よく使う10色に絞る
const TEXT_COLORS: { name: string; value: string }[] = [
  { name: '黒', value: '#1a1a1a' },
  { name: 'グレー', value: '#8a8a8a' },
  { name: '赤', value: '#e03131' },
  { name: 'オレンジ', value: '#f08c00' },
  { name: '黄', value: '#f2c200' },
  { name: '緑', value: '#2f9e44' },
  { name: '青緑', value: '#0ca678' },
  { name: '青', value: '#1971c2' },
  { name: '紫', value: '#7048e8' },
  { name: 'ピンク', value: '#e64980' },
]

// ─── メモ欄のHTMLの取り扱い ───────────────────────────────────────────────────
// メモの内容は全員に配信され、他の人の画面でそのまま表示される。
// HTMLをそのまま流すと <img onerror=...> などで任意のスクリプトを実行させられるため、
// 表示・保存の前に必ず許可したタグ・属性だけに絞る。

const ALLOWED_TAGS = new Set([
  'DIV', 'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'FONT',
  'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'SPAN', 'BLOCKQUOTE', 'CODE', 'PRE', 'HR',
])

// 色だけ許可する（style経由の任意CSSは使わせない）
const COLOR_RE = /^#[0-9a-f]{3,8}$|^rgb\(/i

function sanitizeDocHtml(html: string): string {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const walk = (node: Element) => {
    ;[...node.children].forEach((child) => {
      if (!ALLOWED_TAGS.has(child.tagName)) {
        // 許可しないタグは中身だけ残して包みを外す（テキストは失わない）
        child.replaceWith(...Array.from(child.childNodes))
        return
      }
      ;[...child.attributes].forEach((attr) => {
        const n = attr.name.toLowerCase()
        if (n === 'data-check' || n === 'data-done') return
        if (n === 'color' && COLOR_RE.test(attr.value)) return
        if (n === 'style') {
          const color = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(attr.value)?.[1]?.trim()
          child.setAttribute('style', color && COLOR_RE.test(color) ? `color: ${color}` : '')
          if (!color) child.removeAttribute('style')
          return
        }
        child.removeAttribute(attr.name)
      })
      walk(child)
    })
  }
  walk(tpl.content as unknown as Element)
  return tpl.innerHTML
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// 以前のメモはプレーンテキストで保存されている。そのまま流し込むと改行が潰れるため、
// HTMLらしくなければ1行ずつdivに包んで移行する
function toDocHtml(stored: string): string {
  if (!stored) return ''
  if (/<(div|p|h[1-4]|ul|ol|li|br|span|b|i|u|s|blockquote|hr)\b/i.test(stored)) {
    return sanitizeDocHtml(stored)
  }
  return stored
    .split('\n')
    .map((line) => `<div>${escapeHtml(line) || '<br>'}</div>`)
    .join('')
}

function DocumentEditor({ roomId }: { roomId: string }) {
  const storageKey = `${DOC_STORAGE_PREFIX}${roomId}`
  // 中身はHTML。Reactに再描画させるとカーソルが飛ぶため、DOM側を持ち主にして
  // 初回とリモート更新のときだけこちらから流し込む
  const edRef = useRef<HTMLDivElement>(null)
  // ＋ と T のメニューの開閉
  const [plusOpen, setPlusOpen] = useState(false)
  const [textOpen, setTextOpen] = useState(false)
  const plusRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)

  const sendTimer = useRef<number>()
  const pendingContent = useRef<string | null>(null)

  // 直前に選んでいた範囲。ツールバーを操作すると選択が解除されることがあり、
  // そのまま書式を適用すると「選択中の文字」ではなく「次に打つ文字」に効いてしまう。
  // 覚えておいて、書式を適用する直前に選び直す。
  const savedRange = useRef<Range | null>(null)

  const rememberSelection = () => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    if (!edRef.current?.contains(sel.anchorNode)) return
    savedRange.current = sel.getRangeAt(0).cloneRange()
  }

  const restoreSelection = () => {
    const r = savedRange.current
    if (!r) return
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
  }

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

  const save = (html: string) => {
    const clean = sanitizeDocHtml(html)
    try { localStorage.setItem(storageKey, clean) } catch {}
    scheduleSync(clean)
  }

  // 入力のたびに呼ばれる。ここで中身を書き換えるとカーソルが飛ぶので触らない
  const handleInput = () => {
    if (edRef.current) save(edRef.current.innerHTML)
  }

  // 初回に保存済みの内容を流し込む（部屋・タブが変わったときも）
  useEffect(() => {
    let stored = ''
    try { stored = localStorage.getItem(storageKey) || '' } catch {}
    if (edRef.current) edRef.current.innerHTML = toDocHtml(stored)
  }, [storageKey])

  useEffect(() => {
    const handler = (remoteRoomId: string, remoteContent: string) => {
      if (remoteRoomId !== roomId) return
      // 自分が入力中（フォーカス中）のときはリモート更新で上書きしない
      if (document.activeElement === edRef.current) return
      const clean = toDocHtml(remoteContent)
      if (edRef.current) edRef.current.innerHTML = clean
      try { localStorage.setItem(storageKey, clean) } catch {}
    }
    phaserEvents.on(PhaserEvent.MEETING_DOC_REMOTE_UPDATE, handler)
    getNetwork()?.requestMeetingDocSnapshot(roomId)
    return () => {
      phaserEvents.off(PhaserEvent.MEETING_DOC_REMOTE_UPDATE, handler)
      flushSync()
    }
  }, [roomId, storageKey, flushSync])

  // メニューの外側をクリックしたら閉じる
  useEffect(() => {
    if (!plusOpen && !textOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (plusRef.current?.contains(t) || textRef.current?.contains(t)) return
      setPlusOpen(false)
      setTextOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [plusOpen, textOpen])

  /**
   * 書式を適用する。ブラウザ標準のexecCommandを使う（古いAPIだが、
   * contentEditableの書式付けは今もこれが最も確実に動く）。
   * 選択が外れていると効かないため、必ずエディタに焦点を戻してから実行する。
   */
  const exec = (cmd: string, value?: string) => {
    edRef.current?.focus()
    restoreSelection()
    try {
      // 色などをspanのstyleで表現させる（既定だと廃止済みの<font>タグになる）
      document.execCommand('styleWithCSS', false, 'true')
      document.execCommand(cmd, false, value)
    } catch {}
    handleInput()
    setPlusOpen(false)
    setTextOpen(false)
  }

  // チェックリストは、箇条書きにした上で印を付けて見分ける
  const applyChecklist = () => {
    edRef.current?.focus()
    restoreSelection()
    document.execCommand('insertUnorderedList')
    const sel = window.getSelection()
    let node = sel?.anchorNode as HTMLElement | null
    while (node && node !== edRef.current) {
      if (node.tagName === 'UL') {
        node.setAttribute('data-check', '1')
        break
      }
      node = node.parentElement
    }
    handleInput()
  }

  // チェックの印をクリックしたら 済/未 を切り替える
  const handleClick = (e: React.MouseEvent) => {
    const li = (e.target as HTMLElement).closest('li')
    if (!li || !li.parentElement?.hasAttribute('data-check')) return
    // 印は行頭にあるので、その辺りを押したときだけ反応させる（本文の編集を邪魔しない）
    if (e.clientX - li.getBoundingClientRect().left > 34) return
    li.setAttribute('data-done', li.getAttribute('data-done') === '1' ? '0' : '1')
    handleInput()
  }

  const clearAll = () => {
    if (!window.confirm('ドキュメントをすべて削除しますか？')) return
    if (edRef.current) edRef.current.innerHTML = ''
    save('')
  }

  return (
    <>
      <DocScrollArea>
        <DocEditable
          ref={edRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onBlur={flushSync}
          onClick={handleClick}
          onKeyUp={rememberSelection}
          onMouseUp={rememberSelection}
          spellCheck={false}
          data-placeholder="ここにメモや議事録を入力..."
        />
      </DocScrollArea>
      {/* ツールバーを押した瞬間にエディタから焦点が外れると、選択していた文字が
          選択解除され、色や太字が「選択中の文字」ではなく「次に打つ文字」に
          適用されてしまう。既定動作を止めて選択を保つ。 */}
      <DocToolbar onMouseDown={(e) => e.preventDefault()}>
        {/* ＋ : 挿入メニュー */}
        <DocMenuWrap ref={plusRef}>
          <DocBtn title="挿入" onClick={() => { setPlusOpen((v) => !v); setTextOpen(false) }}>
            ＋ <Caret>▾</Caret>
          </DocBtn>
          {plusOpen && (
            <DocMenu>
              <DocMenuItem onClick={() => exec('insertHorizontalRule')}>
                <span className="k">――</span> 区切り線
              </DocMenuItem>
              <DocMenuItem onClick={() => exec('insertText', todayLabel())}>
                <span className="k">📅</span> 今日の日付
              </DocMenuItem>
              <DocMenuItem onClick={() => exec('formatBlock', 'blockquote')}>
                <span className="k">❝</span> 引用
              </DocMenuItem>
              <DocMenuItem onClick={() => exec('formatBlock', 'pre')}>
                <span className="k">&lt;/&gt;</span> コード
              </DocMenuItem>
            </DocMenu>
          )}
        </DocMenuWrap>

        {/* T : 見出し・装飾・文字色 */}
        <DocMenuWrap ref={textRef}>
          <DocBtn title="文字のスタイル" onClick={() => { setTextOpen((v) => !v); setPlusOpen(false) }}>
            T <Caret>▾</Caret>
          </DocBtn>
          {textOpen && (
            <DocMenu>
              {([1, 2, 3, 4] as const).map((n) => (
                <DocMenuItem key={n} onClick={() => exec('formatBlock', `h${n}`)}>
                  <span className="k">{`H${n}`}</span>
                  <span style={{ fontSize: 21 - n * 1.5, fontWeight: 700 }}>見出し{n}</span>
                </DocMenuItem>
              ))}
              <DocMenuItem onClick={() => exec('formatBlock', 'div')}>
                <span className="k">―</span> 本文に戻す
              </DocMenuItem>
              <DocMenuRow>
                <DocMenuIconBtn title="太字" onClick={() => exec('bold')}><b>B</b></DocMenuIconBtn>
                <DocMenuIconBtn title="斜体" onClick={() => exec('italic')}><i>I</i></DocMenuIconBtn>
                <DocMenuIconBtn title="打ち消し線" onClick={() => exec('strikeThrough')}><s>S</s></DocMenuIconBtn>
                <DocMenuIconBtn title="下線" onClick={() => exec('underline')}><u>U</u></DocMenuIconBtn>
              </DocMenuRow>
              <DocMenuRow>
                {TEXT_COLORS.map((c) => (
                  <ColorDot
                    key={c.value}
                    title={c.name}
                    $color={c.value}
                    onClick={() => exec('foreColor', c.value)}
                  />
                ))}
              </DocMenuRow>
            </DocMenu>
          )}
        </DocMenuWrap>

        <DocSep />

        <DocBtn title="箇条書きリスト" onClick={() => exec('insertUnorderedList')}>☰</DocBtn>
        <DocBtn title="番号付きリスト" onClick={() => exec('insertOrderedList')}>1.</DocBtn>
        <DocBtn title="チェックリスト" onClick={applyChecklist}>☑</DocBtn>

        <DocSep />
        <DocBtn title="全削除" style={{ color: '#c44' }} onClick={clearAll}>消去</DocBtn>
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

  // メモ欄とキャンバスの境目の位置。毎回調整し直さなくて済むようブラウザに覚えさせる
  const [docWidth, setDocWidth] = useState(loadDocWidth)
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
      // ドラッグ中は毎フレーム保存すると無駄なので、離した時点で覚える
      setDocWidth((w) => { saveDocWidth(w); return w })
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
          <LazyWhiteboard key={`wb_${activeTab.id}`} roomId={`${roomId}__${activeTab.id}`} />
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

  // 「同じ会議室に入ったのに相手が表示されない」対策。
  // 参加者が変わったとき（誰かが入室/接続したとき）と、入室直後に何度か、
  // ピア映像を再マウントして取りこぼしを防ぐ。接続はできているのにDOMへの
  // マウントが競合で漏れることがあり、以前は再入室しないと直らなかった。
  const roomPeerKey = activeRoom
    ? Array.from(playerMeetingRoomMap.entries())
        .filter(([, rid]) => rid === activeRoom.id)
        .map(([sid]) => sid)
        .sort()
        .join(',')
    : ''
  useEffect(() => {
    if (!activeRoom) return
    const remount = () => {
      const target = peerContainerRef.current
      if (target) getWebRTC()?.mountPeerVideos(target)
    }
    remount()
    const timers = [400, 1200, 2500].map((ms) => window.setTimeout(remount, ms))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [activeRoom, roomPeerKey, videoConnected])

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
