import React, { useState } from 'react'
import styled from 'styled-components'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'

import { useAppDispatch, useAppSelector } from '../hooks'
import { closeSettingsDialog } from '../stores/SettingsStore'
import { setPlayerName, setAvatarName } from '../stores/UserStore'

import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'

import Adam from '../images/login/Adam_login.png'
import Ash from '../images/login/Ash_login.png'
import Lucy from '../images/login/Lucy_login.png'
import Nancy from '../images/login/Nancy_login.png'

const avatars = [
  { name: 'adam', img: Adam },
  { name: 'ash', img: Ash },
  { name: 'lucy', img: Lucy },
  { name: 'nancy', img: Nancy },
]

const AvatarRow = styled.div`
  display: flex;
  gap: 12px;
  margin-top: 8px;
  flex-wrap: wrap;
`

const AvatarPick = styled.button<{ selected: boolean }>`
  border: 3px solid ${({ selected }) => (selected ? '#5599ee' : 'transparent')};
  border-radius: 10px;
  background: ${({ selected }) => (selected ? '#1a2438' : '#2a2f45')};
  padding: 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  transition: transform 0.1s;
  &:hover { transform: translateY(-2px); }

  img { width: 56px; height: 78px; object-fit: contain; image-rendering: pixelated; }
  span { font-size: 12px; color: #cdd; }
`

const FieldLabel = styled.p`
  margin: 16px 0 4px;
  font-size: 14px;
  color: #aab;
`

export default function SettingsDialog() {
  const dispatch = useAppDispatch()
  const open = useAppSelector((state) => state.settings.settingsDialogOpen)
  const currentName = useAppSelector((state) => state.user.playerName)
  const currentAvatar = useAppSelector((state) => state.user.avatarName)

  const [name, setName] = useState(currentName)
  const [avatar, setAvatar] = useState(currentAvatar)

  // ダイアログを開くたびに現在値へ同期する
  React.useEffect(() => {
    if (open) {
      setName(currentName)
      setAvatar(currentAvatar)
    }
  }, [open, currentName, currentAvatar])

  const getGame = () => phaserGame.scene.keys.game as Game

  const handleSave = () => {
    const game = getGame()
    const trimmed = name.trim()

    if (trimmed && trimmed !== currentName) {
      game?.myPlayer?.setPlayerName(trimmed)
      dispatch(setPlayerName(trimmed))
      try { localStorage.setItem('skyoffice_playerName', trimmed) } catch {}
    }
    if (avatar && avatar !== currentAvatar) {
      game?.myPlayer?.setPlayerTexture(avatar)
      dispatch(setAvatarName(avatar))
      try { localStorage.setItem('skyoffice_avatarName', avatar) } catch {}
    }
    dispatch(closeSettingsDialog())
  }

  return (
    <Dialog open={open} onClose={() => dispatch(closeSettingsDialog())} maxWidth="xs" fullWidth>
      <DialogTitle>設定</DialogTitle>
      <DialogContent>
        <FieldLabel>名前</FieldLabel>
        <TextField
          fullWidth
          size="small"
          variant="outlined"
          value={name}
          onChange={(e) => setName(e.target.value)}
          inputProps={{ maxLength: 30 }}
        />

        <FieldLabel>アバター</FieldLabel>
        <AvatarRow>
          {avatars.map((a) => (
            <AvatarPick key={a.name} selected={avatar === a.name} onClick={() => setAvatar(a.name)}>
              <img src={a.img} alt={a.name} />
              <span>{a.name}</span>
            </AvatarPick>
          ))}
        </AvatarRow>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => dispatch(closeSettingsDialog())} color="inherit">キャンセル</Button>
        <Button onClick={handleSave} variant="contained" color="secondary" disabled={!name.trim()}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  )
}
