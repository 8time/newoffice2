import React, { useState, useEffect } from 'react'
import styled from 'styled-components'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'

import { useAppDispatch, useAppSelector } from '../hooks'
import { setMyStatus } from '../stores/UserStore'
import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'
import { phaserEvents, Event } from '../events/EventCenter'
import { playAwaySound, playPresentSound } from '../util/sound'

const ToggleBar = styled.div`
  padding: 12px 20px;
  border-bottom: 1px solid #2d2d2d;
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const StatusRow = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
`

type StatusType = 'present' | 'away' | 'focus' | 'break'

const STATUS_CONFIG: Record<StatusType, { label: string; color: string; bg: string }> = {
  present: { label: '🟢 在席中',  color: '#44cc77', bg: 'rgba(68,204,119,0.15)' },
  away:    { label: '🔴 離席中',  color: '#ff6b35', bg: 'rgba(255,107,53,0.15)' },
  focus:   { label: '🟡 集中中',  color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  break:   { label: '⏸️ 休憩中', color: '#60a5fa', bg: 'rgba(96,165,250,0.15)' },
}

const StatusButton = styled.button<{ active: boolean; color: string; bg: string }>`
  flex: 1;
  min-width: 110px;
  padding: 10px 8px;
  border-radius: 22px;
  border: 2px solid ${({ active, color }) => (active ? color : '#444')};
  background: ${({ active, bg }) => (active ? bg : 'transparent')};
  color: ${({ active, color }) => (active ? color : '#666')};
  font-size: 18px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s;

  &:hover {
    border-color: ${({ color }) => color};
    color: ${({ color }) => color};
    background: ${({ bg }) => bg};
  }
`

const ReasonPreview = styled.span`
  font-size: 18px;
  color: #999;
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

// 離席理由ダイアログ入力
interface AwayDialogProps {
  open: boolean
  initialMessage: string
  onConfirm: (message: string) => void
  onCancel: () => void
}

function AwayDialog({ open, initialMessage, onConfirm, onCancel }: AwayDialogProps) {
  const [message, setMessage] = useState(initialMessage)

  const inputRef = React.useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setMessage(initialMessage)
      // ダイアログが開いた少し後に確実に入力欄にフォーカスを当てる
      setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
    }
  }, [open, initialMessage])

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth="md"
      fullWidth
      PaperProps={{
        style: {
          background: '#000',
          color: '#fff',
          padding: '16px',
        },
      }}
    >
      <DialogTitle style={{ fontSize: 32, color: '#fff', padding: '16px 24px' }}>
        離席理由を入力
      </DialogTitle>
      <DialogContent>
        <TextField
          inputRef={inputRef}
          autoFocus
          multiline
          rows={5}
          fullWidth
          variant="outlined"
          label="離席理由（任意）"
          placeholder="例：昼食中、会議中、外出中..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onConfirm(message)
            }
          }}
          inputProps={{ maxLength: 200, style: { fontSize: 26, color: '#fff' } }}
          InputLabelProps={{ style: { fontSize: 22, color: '#aaa' } }}
          sx={{
            '& .MuiOutlinedInput-root': {
              '& fieldset': { borderColor: '#555' },
              '&:hover fieldset': { borderColor: '#888' },
              '&.Mui-focused fieldset': { borderColor: '#aaa' },
              background: '#111',
            },
          }}
        />
        <p style={{ fontSize: 20, color: '#aaa', marginTop: 12 }}>
          長文は吹き出しをクリックすると読めます
        </p>
      </DialogContent>
      <DialogActions style={{ padding: '16px 24px', gap: 16 }}>
        <Button
          onClick={onCancel}
          color="inherit"
          style={{ fontSize: 22, color: '#ccc', border: '1px solid #555', padding: '8px 24px' }}
        >
          キャンセル
        </Button>
        <Button
          onClick={() => onConfirm(message)}
          color="warning"
          variant="contained"
          style={{ fontSize: 22, padding: '10px 32px' }}
        >
          離席する
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// 吹き出し全文表示ダイアログ
interface AwayMessageDialogProps {
  open: boolean
  playerId: string
  message: string
  onClose: () => void
}

export function AwayMessageDialog({ open, playerId, message, onClose }: AwayMessageDialogProps) {
  const playerNameMap = useAppSelector((state) => state.user.playerNameMap)
  const name = playerNameMap.get(playerId) || '不明なユーザー'

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{name} の離席理由</DialogTitle>
      <DialogContent>
        <p style={{ whiteSpace: 'pre-wrap', color: '#333' }}>{message || '（理由なし）'}</p>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="primary">閉じる</Button>
      </DialogActions>
    </Dialog>
  )
}

export default function StatusToggle() {
  const dispatch = useAppDispatch()
  const myStatus = useAppSelector((state) => state.user.myStatus)
  const myAwayMessage = useAppSelector((state) => state.user.myAwayMessage)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [awayMsgDialogOpen, setAwayMsgDialogOpen] = useState(false)
  const [awayMsgTarget, setAwayMsgTarget] = useState({ playerId: '', message: '' })

  const getGame = () => phaserGame.scene.keys.game as Game

  // 吹き出しクリックイベントを受信
  useEffect(() => {
    const handler = (playerId: string, message: string) => {
      setAwayMsgTarget({ playerId, message })
      setAwayMsgDialogOpen(true)
    }
    phaserEvents.on(Event.SHOW_AWAY_MESSAGE, handler)
    return () => { phaserEvents.off(Event.SHOW_AWAY_MESSAGE, handler) }
  }, [])

  const applyStatus = (status: StatusType, message = '') => {
    const wasPresent = myStatus === 'present'
    const goingPresent = status === 'present'

    dispatch(setMyStatus({ status, awayMessage: message }))

    const game = getGame()
    if (status === 'present') {
      game?.myPlayer?.clearAwayStatus()
    } else {
      game?.myPlayer?.setAwayStatus(message || STATUS_CONFIG[status].label)
    }
    game?.network?.updateStatus(status, message)

    if (goingPresent && !wasPresent) playPresentSound()
    else if (!goingPresent && wasPresent) playAwaySound()
  }

  const handleClick = (status: StatusType) => {
    if (status === myStatus) return
    if (status === 'away') {
      setDialogOpen(true)
    } else {
      applyStatus(status)
    }
  }

  const goAway = (message: string) => {
    setDialogOpen(false)
    applyStatus('away', message)
  }

  return (
    <>
      <ToggleBar>
        <StatusRow>
          {(Object.entries(STATUS_CONFIG) as [StatusType, typeof STATUS_CONFIG[StatusType]][]).map(([key, cfg]) => (
            <StatusButton
              key={key}
              active={myStatus === key}
              color={cfg.color}
              bg={cfg.bg}
              onClick={() => handleClick(key)}
              title={key === 'focus' ? '集中モード（話しかけ不可）' : key === 'break' ? '休憩中' : undefined}
            >
              {cfg.label}
            </StatusButton>
          ))}
        </StatusRow>
        {myStatus === 'away' && myAwayMessage && (
          <ReasonPreview title={myAwayMessage}>{myAwayMessage}</ReasonPreview>
        )}
      </ToggleBar>

      <AwayDialog
        open={dialogOpen}
        initialMessage={myAwayMessage}
        onConfirm={goAway}
        onCancel={() => setDialogOpen(false)}
      />

      <AwayMessageDialog
        open={awayMsgDialogOpen}
        playerId={awayMsgTarget.playerId}
        message={awayMsgTarget.message}
        onClose={() => setAwayMsgDialogOpen(false)}
      />
    </>
  )
}
