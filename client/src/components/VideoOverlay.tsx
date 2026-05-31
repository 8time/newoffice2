import React, { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import MicIcon from '@mui/icons-material/Mic'
import MicOffIcon from '@mui/icons-material/MicOff'
import VideocamIcon from '@mui/icons-material/Videocam'
import VideocamOffIcon from '@mui/icons-material/VideocamOff'
import ScreenShareIcon from '@mui/icons-material/ScreenShare'
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare'
import MapIcon from '@mui/icons-material/Map'
import SignpostIcon from '@mui/icons-material/Signpost'
import PersonAddIcon from '@mui/icons-material/PersonAdd'
import Tooltip from '@mui/material/Tooltip'
import IconButton from '@mui/material/IconButton'

import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'
import { useAppSelector, useAppDispatch } from '../hooks'
import { toggleBuilderMode } from '../stores/MapBuilderStore'
import { openSignboardDialog } from '../stores/SignboardStore'
import { phaserEvents, Event } from '../events/EventCenter'

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

const SIDEBAR_WIDTH = 525

/* カメラ枠を並べる透明コンテナ（背景なし） */
const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: ${SIDEBAR_WIDTH}px;
  height: 360px;
  background: transparent;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 16px;
  z-index: 200;
  pointer-events: none;
  overflow-x: auto;
  overflow-y: hidden;

  &::-webkit-scrollbar {
    height: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background: #555;
    border-radius: 2px;
  }
`

/* 個別カメラ枠 */
const VideoCard = styled.div`
  position: relative;
  width: 495px;
  min-width: 495px;
  height: 324px;
  flex-shrink: 0;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(34, 34, 34, 0.5);
  backdrop-filter: blur(6px);
  border: 4px solid #00CCCC;
  pointer-events: auto;

  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scaleX(-1);
  }

  /* 名前ラベル */
  .label {
    position: absolute;
    bottom: 12px;
    left: 12px;
    font-size: 26px;
    color: #fff;
    background: rgba(0, 0, 0, 0.60);
    border-radius: 6px;
    padding: 4px 16px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    /* ボタンの上にラベルが重ならないよう右端を空ける */
    right: 170px;
  }

  /* マイク・カメラボタン（枠内・右下に常時表示） */
  .card-controls {
    position: absolute;
    bottom: 12px;
    right: 12px;
    display: flex;
    gap: 8px;
    pointer-events: auto;
  }
`

const CardCtrlBtn = styled(IconButton)<{ isOff?: boolean }>`
  && {
    width: 68px;
    height: 68px;
    background: ${({ isOff }) =>
      isOff ? 'rgba(220, 50, 50, 0.85)' : 'rgba(0, 0, 0, 0.55)'};
    color: #fff;
    border-radius: 50%;
    padding: 0;

    &:hover {
      background: ${({ isOff }) =>
        isOff ? 'rgba(220, 50, 50, 1)' : 'rgba(0, 0, 0, 0.80)'};
    }

    svg {
      font-size: 36px;
    }
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

const PeerVideosContainer = styled.div`
  display: flex;
  gap: 10px;
  align-items: flex-start;
  pointer-events: auto;

  .peer-video-wrapper {
    width: 495px;
    height: 324px;
    border-radius: 10px;
    border: 4px solid #00CCCC;
    flex-shrink: 0;
    position: relative;
    overflow: hidden;
    background: #222;
  }

  .peer-video-wrapper video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`

/* 画面共有ボタン：画面下部中央に固定 */
const ScreenShareBar = styled.div`
  position: fixed;
  bottom: 24px;
  left: calc(50% - ${SIDEBAR_WIDTH / 2}px);
  transform: translateX(-50%);
  z-index: 300;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 24px;
  pointer-events: auto;
`

const ControlItem = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
`

const ScreenShareBtn = styled(IconButton)<{ isActive?: boolean }>`
  && {
    width: 156px;
    height: 156px;
    background: ${({ isActive }) =>
      isActive ? 'rgba(220, 50, 50, 0.90)' : 'rgba(30, 30, 30, 0.85)'};
    color: #fff;
    border-radius: 50%;
    border: 3px solid ${({ isActive }) => (isActive ? '#ff4444' : '#666')};
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.6);

    &:hover {
      background: ${({ isActive }) =>
        isActive ? 'rgba(220, 50, 50, 1)' : 'rgba(60, 60, 60, 0.95)'};
    }

    svg {
      font-size: 78px;
    }
  }
`

const ScreenShareLabel = styled.span<{ isActive?: boolean }>`
  font-size: 22px;
  font-weight: 700;
  color: ${({ isActive }) => (isActive ? '#ff6666' : '#ffffff')};
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8);
  letter-spacing: 0.5px;
`

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

interface VideoState {
  isAudioMuted: boolean
  isVideoOff: boolean
  isSharingScreen: boolean
  hasStream: boolean
}

export default function VideoOverlay() {
  const peerContainerRef = useRef<HTMLDivElement>(null)
  const loggedIn = useAppSelector((state) => state.user.loggedIn)
  const videoConnected = useAppSelector((state) => state.user.videoConnected)
  const playerNameMap = useAppSelector((state) => state.user.playerNameMap)
  const sessionId = useAppSelector((state) => state.user.sessionId)
  const myAvatarName = useAppSelector((state) => state.user.avatarName) || 'adam'
  const myPlayerName = useAppSelector((state) => state.user.playerName) || 'あなた'
  const isBuilderMode = useAppSelector((state) => state.mapBuilder.isBuilderMode)
  const dispatch = useAppDispatch()

  const [videoState, setVideoState] = useState<VideoState>({
    isAudioMuted: false,
    isVideoOff: false,
    isSharingScreen: false,
    hasStream: false,
  })

  const getWebRTC = () => {
    const game = phaserGame.scene.keys.game as Game
    return game?.network?.webRTC
  }

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

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as VideoState
      setVideoState(detail)
    }
    window.addEventListener('webrtc-state-change', handler)
    return () => window.removeEventListener('webrtc-state-change', handler)
  }, [])

  useEffect(() => {
    if (!peerContainerRef.current) return
    const peerTarget = peerContainerRef.current
    getWebRTC()?.mountPeerVideos(peerTarget)

    const srcGrid = document.getElementById('webrtc-video-source')
    if (!srcGrid) return
    const observer = new MutationObserver(() => {
      while (srcGrid.firstChild) peerTarget.appendChild(srcGrid.firstChild)
    })
    observer.observe(srcGrid, { childList: true })
    return () => observer.disconnect()
  }, [videoConnected])

  useEffect(() => {
    if (videoConnected && !videoState.isVideoOff) {
      getWebRTC()?.attachLocalVideo('my-video-mount')
    }
  }, [videoConnected, videoState.isVideoOff])

  const handleToggleMic = () => getWebRTC()?.toggleMute()
  const handleToggleVideo = () => getWebRTC()?.toggleVideo()
  const handleToggleScreen = () => {
    const rtc = getWebRTC()
    if (!rtc) return
    rtc.isSharingScreen ? rtc.stopScreenShare() : rtc.startScreenShare()
  }

  const handleBuilderToggle = () => {
    dispatch(toggleBuilderMode())
    if (!isBuilderMode) {
      phaserEvents.emit(Event.BUILDER_ENTER)
    } else {
      phaserEvents.emit(Event.BUILDER_EXIT)
    }
  }

  const handleInvite = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      window.alert('招待URLをクリップボードにコピーしました！\nこのURLを共有して他の人を招待してください。')
    }).catch((err) => {
      console.error('URLのコピーに失敗しました', err)
      window.alert('URLのコピーに失敗しました。ブラウザのURLバーから直接コピーしてください。')
    })
  }

  if (!loggedIn) return null

  const myName = myPlayerName

  return (
    <>
      {/* カメラ枠（上部・背景なし） */}
      <Overlay>
        {videoConnected && (
          <VideoCard>
            {videoState.isVideoOff ? (
              <AvatarFallback $bgGradient={getGradient(sessionId || myName)}>
                <img src={avatarMap[myAvatarName]} alt={myAvatarName} />
              </AvatarFallback>
            ) : (
              <div id="my-video-mount" style={{ width: '100%', height: '100%' }} />
            )}
            <div className="label">{myName}（自分）</div>

            {/* マイク・カメラ切替ボタン（枠内右下） */}
            <div className="card-controls">
              <Tooltip title={videoState.isAudioMuted ? 'ミュート解除' : 'ミュート'}>
                <CardCtrlBtn isOff={videoState.isAudioMuted} onClick={handleToggleMic}>
                  {videoState.isAudioMuted ? <MicOffIcon /> : <MicIcon />}
                </CardCtrlBtn>
              </Tooltip>
              <Tooltip title={videoState.isVideoOff ? 'カメラON' : 'カメラOFF'}>
                <CardCtrlBtn isOff={videoState.isVideoOff} onClick={handleToggleVideo}>
                  {videoState.isVideoOff ? <VideocamOffIcon /> : <VideocamIcon />}
                </CardCtrlBtn>
              </Tooltip>
            </div>
          </VideoCard>
        )}

        {/* 他参加者のビデオ */}
        <PeerVideosContainer ref={peerContainerRef} />
      </Overlay>

      {/* 画面下部中央コントロールバー */}
      {videoConnected && (
        <ScreenShareBar>
          <ControlItem>
            <ScreenShareBtn isActive={videoState.isSharingScreen} onClick={handleToggleScreen}>
              {videoState.isSharingScreen ? <StopScreenShareIcon /> : <ScreenShareIcon />}
            </ScreenShareBtn>
            <ScreenShareLabel isActive={videoState.isSharingScreen}>
              {videoState.isSharingScreen ? '共有停止' : '画面共有'}
            </ScreenShareLabel>
          </ControlItem>

          <ControlItem>
            <ScreenShareBtn onClick={() => dispatch(openSignboardDialog())}>
              <SignpostIcon />
            </ScreenShareBtn>
            <ScreenShareLabel>看板を設置</ScreenShareLabel>
          </ControlItem>

          <ControlItem>
            <ScreenShareBtn isActive={isBuilderMode} onClick={handleBuilderToggle}>
              <MapIcon />
            </ScreenShareBtn>
            <ScreenShareLabel isActive={isBuilderMode}>
              {isBuilderMode ? 'ビルダー終了' : 'マップビルダー'}
            </ScreenShareLabel>
          </ControlItem>

          <ControlItem>
            <ScreenShareBtn onClick={handleInvite}>
              <PersonAddIcon />
            </ScreenShareBtn>
            <ScreenShareLabel>招待</ScreenShareLabel>
          </ControlItem>
        </ScreenShareBar>
      )}
    </>
  )
}
