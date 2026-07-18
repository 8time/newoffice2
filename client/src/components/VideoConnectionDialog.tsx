import React, { useState } from 'react'
import styled, { keyframes } from 'styled-components'
import VideocamIcon from '@mui/icons-material/Videocam'
import MicIcon from '@mui/icons-material/Mic'

import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'

// 右サイドバーの幅。カードはこれを避けてマップ側の中央に置く
const SIDEBAR_WIDTH = 525

const slideDown = keyframes`
  from { transform: translateY(-16px); opacity: 0; }
  to   { transform: translateY(0);     opacity: 1; }
`

// ボタンにゆっくり脈打つ光を出して視線を集める（気づかれないのが元々の問題なので）
const glow = keyframes`
  0%, 100% { box-shadow: 0 0 0 0 rgba(76, 175, 120, 0.55); }
  50%      { box-shadow: 0 0 0 10px rgba(76, 175, 120, 0); }
`

// マップ側の上部中央に配置する土台。サイドバーには重ならない。
// pointer-events:none にして、カード以外はマップ操作を邪魔しない
const Anchor = styled.div`
  position: fixed;
  top: 18px;
  left: 16px;
  right: ${SIDEBAR_WIDTH + 16}px;
  z-index: 300;
  display: flex;
  justify-content: center;
  pointer-events: none;
`

const Card = styled.div`
  pointer-events: auto;
  max-width: 460px;
  width: 100%;
  background: rgba(24, 28, 38, 0.97);
  border: 1px solid rgba(120, 200, 150, 0.5);
  border-radius: 16px;
  padding: 18px 20px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(8px);
  animation: ${slideDown} 0.35s ease;
  color: #eef2f0;

  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 18px;
    font-weight: 700;
    color: #bff0cf;
  }
  .head .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: rgba(76, 175, 120, 0.2);
    flex-shrink: 0;
  }
  .body {
    margin: 10px 0 16px;
    font-size: 14px;
    line-height: 1.6;
    color: #cfd6d2;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 14px;
  }
`

const ConnectBtn = styled.button`
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: linear-gradient(135deg, #2e9e5b, #1f7d45);
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 12px 18px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  animation: ${glow} 2.4s ease-in-out infinite;
  transition: filter 0.12s;

  &:hover { filter: brightness(1.1); }
`

const LaterBtn = styled.button`
  background: none;
  border: none;
  color: #9aa4a0;
  font-size: 13px;
  cursor: pointer;
  flex-shrink: 0;
  padding: 6px;
  &:hover { color: #d6ddd9; }
`

// 「あとで」で畳んだときに残す小さな常設ボタン。完全に消すと元の
// 「気づかない」問題に戻るため、押せばいつでも通話を有効化できるようにしておく
const Pill = styled.button`
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(24, 28, 38, 0.95);
  color: #bff0cf;
  border: 1px solid rgba(120, 200, 150, 0.5);
  border-radius: 999px;
  padding: 9px 16px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
  animation: ${slideDown} 0.3s ease;
  &:hover { background: rgba(40, 48, 62, 0.98); }
`

export default function VideoConnectionDialog() {
  const [minimized, setMinimized] = useState(false)

  const connect = () => {
    const game = phaserGame.scene.keys.game as Game
    game.network.webRTC?.getUserMedia()
  }

  if (minimized) {
    return (
      <Anchor>
        <Pill onClick={connect} title="カメラ・マイクを接続して通話できるようにする">
          <MicIcon fontSize="small" />
          通話をはじめる
        </Pill>
      </Anchor>
    )
  }

  return (
    <Anchor>
      <Card>
        <div className="head">
          <span className="badge">
            <VideocamIcon style={{ color: '#7fe0a0' }} />
          </span>
          近くの人と話すには接続してください
        </div>
        <div className="body">
          カメラ・マイクを接続すると、マップ上で<strong>近づいた人と自動でビデオ・音声通話</strong>ができます。
          （あとで下の「通話をはじめる」からいつでも接続できます）
        </div>
        <div className="actions">
          <ConnectBtn onClick={connect}>
            <MicIcon fontSize="small" />
            カメラ・マイクを接続する
          </ConnectBtn>
          <LaterBtn onClick={() => setMinimized(true)}>あとで</LaterBtn>
        </div>
      </Card>
    </Anchor>
  )
}
