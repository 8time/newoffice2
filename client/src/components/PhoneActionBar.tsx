import React, { useState } from 'react'
import ScreenShareIcon from '@mui/icons-material/ScreenShare'
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare'
import SettingsIcon from '@mui/icons-material/Settings'
import LogoutIcon from '@mui/icons-material/Logout'
import MoreHorizIcon from '@mui/icons-material/MoreHoriz'
import SignpostIcon from '@mui/icons-material/Signpost'
import MapIcon from '@mui/icons-material/Map'
import PersonAddIcon from '@mui/icons-material/PersonAdd'

import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'
import { useAppDispatch, useAppSelector } from '../hooks'
import { toggleBuilderMode } from '../stores/MapBuilderStore'
import { openSignboardDialog } from '../stores/SignboardStore'
import { openSettingsDialog } from '../stores/SettingsStore'
import { openExitDialog } from '../stores/UiStore'
import { phaserEvents, Event as PhaserEvent } from '../events/EventCenter'

export default function PhoneActionBar() {
  const dispatch = useAppDispatch()
  const videoConnected = useAppSelector((state) => state.user.videoConnected)
  const isBuilderMode = useAppSelector((state) => state.mapBuilder.isBuilderMode)
  const [moreOpen, setMoreOpen] = useState(false)
  const [sharing, setSharing] = useState(false)

  const getWebRTC = () => {
    const game = phaserGame.scene.keys.game as Game
    return game?.network?.webRTC
  }

  React.useEffect(() => {
    const handler = (e: globalThis.Event) => {
      const detail = (e as CustomEvent).detail as { isSharingScreen?: boolean }
      if (detail?.isSharingScreen !== undefined) setSharing(!!detail.isSharingScreen)
    }
    window.addEventListener('webrtc-state-change', handler)
    const rtc = getWebRTC()
    if (rtc) setSharing(!!rtc.isSharingScreen)
    return () => window.removeEventListener('webrtc-state-change', handler)
  }, [videoConnected])

  const handleToggleScreen = () => {
    const rtc = getWebRTC()
    if (!rtc) return
    rtc.isSharingScreen ? rtc.stopScreenShare() : rtc.startScreenShare()
  }

  const handleBuilderToggle = () => {
    dispatch(toggleBuilderMode())
    if (!isBuilderMode) phaserEvents.emit(PhaserEvent.BUILDER_ENTER)
    else phaserEvents.emit(PhaserEvent.BUILDER_EXIT)
    setMoreOpen(false)
  }

  const handleInvite = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      window.alert('招待URLをコピーしました')
    }).catch(() => {
      window.alert('URLのコピーに失敗しました')
    })
    setMoreOpen(false)
  }

  return (
    <>
      <div className="phone-action-bar">
        <button
          type="button"
          className={`phone-action-btn${sharing ? ' active' : ''}`}
          disabled={!videoConnected}
          onClick={handleToggleScreen}
          aria-label="画面共有"
        >
          {sharing ? <StopScreenShareIcon /> : <ScreenShareIcon />}
          <span>{sharing ? '停止' : '共有'}</span>
        </button>
        <button
          type="button"
          className="phone-action-btn"
          onClick={() => dispatch(openSettingsDialog())}
          aria-label="設定"
        >
          <SettingsIcon />
          <span>設定</span>
        </button>
        <button
          type="button"
          className="phone-action-btn"
          onClick={() => dispatch(openExitDialog())}
          aria-label="退社"
        >
          <LogoutIcon />
          <span>退社</span>
        </button>
        <button
          type="button"
          className="phone-action-btn"
          onClick={() => setMoreOpen((v) => !v)}
          aria-label="その他"
        >
          <MoreHorizIcon />
          <span>その他</span>
        </button>
      </div>
      {moreOpen && (
        <>
          <div
            role="presentation"
            style={{ position: 'fixed', inset: 0, zIndex: 1299 }}
            onClick={() => setMoreOpen(false)}
          />
          <div className="phone-more-menu">
            <button type="button" onClick={() => { dispatch(openSignboardDialog()); setMoreOpen(false) }}>
              <SignpostIcon style={{ verticalAlign: 'middle', marginRight: 8, fontSize: 18 }} />
              看板を設置
            </button>
            <button type="button" onClick={handleBuilderToggle}>
              <MapIcon style={{ verticalAlign: 'middle', marginRight: 8, fontSize: 18 }} />
              {isBuilderMode ? 'ビルダー終了' : 'マップビルダー'}
            </button>
            <button type="button" onClick={handleInvite}>
              <PersonAddIcon style={{ verticalAlign: 'middle', marginRight: 8, fontSize: 18 }} />
              招待
            </button>
          </div>
        </>
      )}
    </>
  )
}
