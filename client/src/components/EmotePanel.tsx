import React, { useState } from 'react'
import styled from 'styled-components'
import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'
import { playEmoteSound } from '../util/sound'

const EMOTES = ['👍', '😂', '❓', '🎉', '👏', '😮', '❤️', '🙏']

const Wrapper = styled.div`
  position: fixed;
  bottom: 16px;
  left: 16px;
  z-index: 200;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  pointer-events: auto;
`

const ToggleBtn = styled.button`
  background: rgba(30, 30, 40, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  width: 44px;
  height: 44px;
  font-size: 22px;
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: transform 0.15s;

  &:hover { transform: scale(1.15); }
`

const Tray = styled.div`
  display: flex;
  gap: 6px;
  background: rgba(20, 20, 30, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 30px;
  padding: 6px 10px;
  backdrop-filter: blur(10px);
`

const EmoteBtn = styled.button`
  background: none;
  border: none;
  font-size: 26px;
  cursor: pointer;
  padding: 4px;
  border-radius: 8px;
  transition: transform 0.12s, background 0.12s;

  &:hover {
    transform: scale(1.3);
    background: rgba(255, 255, 255, 0.1);
  }

  &:active { transform: scale(0.95); }
`

export default function EmotePanel() {
  const [open, setOpen] = useState(false)

  const send = (emoji: string) => {
    const game = phaserGame.scene.keys.game as Game
    game?.network?.sendEmote(emoji)
    playEmoteSound()
    setOpen(false)
  }

  return (
    <Wrapper>
      {open && (
        <Tray>
          {EMOTES.map((e) => (
            <EmoteBtn key={e} onClick={() => send(e)} title={e}>
              {e}
            </EmoteBtn>
          ))}
        </Tray>
      )}
      <ToggleBtn onClick={() => setOpen((v) => !v)} title="エモート">
        😊
      </ToggleBtn>
    </Wrapper>
  )
}
