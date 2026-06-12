import React, { useEffect, useRef } from 'react'
import styled from 'styled-components'
import { useAppSelector, useAppDispatch } from '../hooks'
import { clearDeleteConfirm } from '../stores/SignboardStore'
import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'

const Popup = styled.div<{ x: number; y: number }>`
  position: fixed;
  left: ${({ x }) => x}px;
  top: ${({ y }) => y}px;
  background: rgba(20, 20, 35, 0.97);
  border: 1px solid rgba(255, 80, 80, 0.5);
  border-radius: 12px;
  padding: 14px 18px;
  z-index: 9000;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
  min-width: 180px;
  backdrop-filter: blur(8px);
`

const Message = styled.div`
  font-size: 14px;
  color: #e0f2fe;
  margin-bottom: 12px;
  text-align: center;
`

const BtnRow = styled.div`
  display: flex;
  gap: 8px;
`

const Btn = styled.button<{ danger?: boolean }>`
  flex: 1;
  padding: 7px 0;
  border-radius: 8px;
  border: 1px solid ${({ danger }) => (danger ? 'rgba(255,80,80,0.5)' : 'rgba(255,255,255,0.15)')};
  background: ${({ danger }) => (danger ? 'rgba(220,50,50,0.2)' : 'transparent')};
  color: ${({ danger }) => (danger ? '#ff6b6b' : '#94a3b8')};
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
  &:hover { opacity: 0.75; }
`

export default function SignboardDeleteConfirm() {
  const dispatch = useAppDispatch()
  const confirm = useAppSelector((state) => state.signboard.deleteConfirm)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!confirm) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        dispatch(clearDeleteConfirm())
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [confirm, dispatch])

  if (!confirm) return null

  const handleYes = () => {
    const game = phaserGame.scene.keys.game as Game
    game?.network?.removeSignboard(confirm.id)
    dispatch(clearDeleteConfirm())
  }

  const handleNo = () => {
    dispatch(clearDeleteConfirm())
  }

  // ポップアップがビューポート端に被らないように調整
  const px = Math.min(confirm.x, window.innerWidth - 210)
  const py = Math.min(confirm.y, window.innerHeight - 100)

  return (
    <div ref={ref}>
      <Popup x={px} y={py}>
        <Message>🗑️ 看板を削除しますか？</Message>
        <BtnRow>
          <Btn onClick={handleNo}>いいえ</Btn>
          <Btn danger onClick={handleYes}>はい・削除</Btn>
        </BtnRow>
      </Popup>
    </div>
  )
}
