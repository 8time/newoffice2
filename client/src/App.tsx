import React, { useEffect, useState } from 'react'
import styled from 'styled-components'

import { useAppSelector } from './hooks'

import RoomSelectionDialog from './components/RoomSelectionDialog'
import LoginDialog from './components/LoginDialog'
import ComputerDialog from './components/ComputerDialog'
import WhiteboardDialog from './components/WhiteboardDialog'
import VideoConnectionDialog from './components/VideoConnectionDialog'
import Chat from './components/Chat'
import HelperButtonGroup from './components/HelperButtonGroup'
import MobileVirtualJoystick from './components/MobileVirtualJoystick'
import MapBuilder from './components/MapBuilder'
import JukeboxDialog from './components/JukeboxDialog'
import PredictionBoardDialog from './components/PredictionBoardDialog'
import SignboardDialog from './components/SignboardDialog'
import VideoOverlay from './components/VideoOverlay'
import OnlineUsers from './components/OnlineUsers'
import AttendancePanel from './components/AttendancePanel'
import StatusToggle from './components/StatusToggle'
import MeetingRoomOverlay from './components/MeetingRoomOverlay'

// ReactのUIオーバーレイの最外枠
const Backdrop = styled.div`
  position: absolute;
  height: 100%;
  width: 100%;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 5;

  > * {
    pointer-events: auto;
  }
`

// ログイン後に右側に表示される固定幅525pxのサイドバー
const SidebarArea = styled.div`
  position: fixed;
  top: 0;
  right: 0;
  width: 525px;
  height: 100vh;
  background-color: #1e1e1e;
  border-left: 1px solid #2d2d2d;
  display: flex;
  flex-direction: column;
  color: #e0e0e0;
  font-family: 'Roboto', 'Inter', sans-serif;
  z-index: 1000;
  pointer-events: auto;
  box-shadow: -5px 0 15px rgba(0, 0, 0, 0.5);
  overflow-y: auto;
`

const SidebarHeader = styled.div`
  padding: 14px 18px;
  background-color: #1a6b2a;
  border-bottom: 1px solid #145220;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;

  h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: 0.5px;
  }
`

// チャットを埋め込むためのラッパー
const ChatSidebarWrapper = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  background-color: #1e1e1e;
  min-height: 280px;

  > div {
    position: relative !important;
    bottom: auto !important;
    left: auto !important;
    height: 100% !important;
    width: 100% !important;
    max-height: none !important;
    max-width: none !important;
    pointer-events: auto;

    > div {
      height: 100% !important;
      padding: 12px !important;
    }
  }
`

// ビデオグリッドのサイドバー側プレースホルダー（VideoOverlayに移植済み）
const HiddenVideoGrid = styled.div`
  display: none;
`

const ClockWrapper = styled.div`
  font-size: 28px;
  color: #FFFF33;
  font-family: monospace;
`

function CurrentTime() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  const ampm = time.getHours() < 12 ? 'AM' : 'PM'
  const hours12 = time.getHours() % 12 || 12
  const formatted = `${time.getFullYear()}/${String(time.getMonth() + 1).padStart(2, '0')}/${String(time.getDate()).padStart(2, '0')} ${ampm} ${String(hours12).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
  return <ClockWrapper>{formatted}</ClockWrapper>
}

function App() {
  const loggedIn = useAppSelector((state) => state.user.loggedIn)
  const computerDialogOpen = useAppSelector((state) => state.computer.computerDialogOpen)
  const whiteboardDialogOpen = useAppSelector((state) => state.whiteboard.whiteboardDialogOpen)
  const videoConnected = useAppSelector((state) => state.user.videoConnected)
  const roomJoined = useAppSelector((state) => state.room.roomJoined)
  const isBuilderMode = useAppSelector((state) => state.mapBuilder.isBuilderMode)
  const activeMeetingRoom = useAppSelector((state) => state.meetingRoom.activeRoom)
  const signboardDialogOpen = useAppSelector((state) => state.signboard.signboardDialogOpen)

  useEffect(() => {
    if (loggedIn) {
      document.body.classList.add('logged-in')
    } else {
      document.body.classList.remove('logged-in')
    }
  }, [loggedIn])

  let ui: JSX.Element
  if (loggedIn) {
    if (computerDialogOpen) {
      ui = <ComputerDialog />
    } else if (whiteboardDialogOpen) {
      ui = <WhiteboardDialog />
    } else {
      ui = (
        <>
          {!videoConnected && <VideoConnectionDialog />}
          <MobileVirtualJoystick />
        </>
      )
    }
  } else if (roomJoined) {
    ui = <LoginDialog />
  } else {
    ui = <RoomSelectionDialog />
  }

  return (
    <>
      <Backdrop>
        {ui}
        {loggedIn && !computerDialogOpen && !whiteboardDialogOpen && <HelperButtonGroup />}
        {loggedIn && isBuilderMode && <MapBuilder />}
        {loggedIn && <JukeboxDialog />}
        {loggedIn && <PredictionBoardDialog />}
        {/* 隠しビデオソース（WebRTC の DOM 操作の受け皿、VideoOverlay の MutationObserver が監視） */}
        <HiddenVideoGrid>
          <div id="webrtc-video-source" />
          <div id="webrtc-button-source" />
        </HiddenVideoGrid>
      </Backdrop>

      {/* MAP上部のビデオオーバーレイ（Metalife風） */}
      {loggedIn && !activeMeetingRoom && <VideoOverlay />}
      {loggedIn && activeMeetingRoom && <MeetingRoomOverlay />}

      {/* 看板の入力ダイアログ（サイドバーより前面に出すためルート直下に配置） */}
      {loggedIn && signboardDialogOpen && <SignboardDialog />}

      {/* 右サイドバー */}
      {loggedIn && (
        <SidebarArea>
          <SidebarHeader>
            <h2>SkyOffice</h2>
            <CurrentTime />
          </SidebarHeader>

          {/* 着席/離席ステータス切り替え */}
          <StatusToggle />

          {/* 出社者一覧 */}
          <OnlineUsers />

          {/* 勤怠記録 */}
          <AttendancePanel />

          {/* チャット */}
          <ChatSidebarWrapper>
            <Chat />
          </ChatSidebarWrapper>
        </SidebarArea>
      )}
    </>
  )
}

export default App
