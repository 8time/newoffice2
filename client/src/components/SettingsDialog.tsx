import React, { useState } from 'react'
import styled from 'styled-components'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'

import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'

import { useAppDispatch, useAppSelector } from '../hooks'
import { closeSettingsDialog } from '../stores/SettingsStore'
import { openStampManager } from '../stores/StampStore'
import { setPlayerName, setAvatarName, setShowJoystick, toggleBackgroundMode } from '../stores/UserStore'
import { BackgroundMode } from '../../../types/BackgroundMode'
import { buildRoomUrl } from '../util/roomKey'

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

// ルーム情報・操作ガイドは、以前はMAP右下の白い丸アイコンから開いていたが、
// 画面の隅を占領して他の表示とぶつかるため、設定の中にまとめた
const InfoBox = styled.div`
  background: rgba(0, 0, 0, 0.04);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.8;
  word-break: break-all;

  .row { display: flex; gap: 6px; }
  .k { color: #666; flex-shrink: 0; }
  .v { font-weight: 600; }
`

const GuideList = styled.ul`
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  line-height: 1.9;
  li strong { color: #1a6b2a; }
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
  const showJoystick = useAppSelector((state) => state.user.showJoystick)
  const backgroundMode = useAppSelector((state) => state.user.backgroundMode)
  const roomName = useAppSelector((state) => state.room.roomName)
  const roomId = useAppSelector((state) => state.room.roomId)
  const roomKey = useAppSelector((state) => state.room.roomKey)
  const [copied, setCopied] = useState(false)
  const stampCount = useAppSelector((state) => Object.keys(state.stamp.stamps).length)

  const [name, setName] = useState(currentName)
  const [avatar, setAvatar] = useState(currentAvatar)
  // 設置した看板・画像の一覧（画面端で押せないものもここから削除できる）
  const [signs, setSigns] = useState<Array<{ id: string; text: string; image: string }>>([])

  const getGame = () => phaserGame.scene.keys.game as Game

  // Phaser側の signboardData から一覧を取り出す（Reduxには無いので直接読む）
  const refreshSigns = () => {
    const map = (getGame() as unknown as { signboardData?: Map<string, { id: string; text?: string; image?: string }> })?.signboardData
    const list = map ? [...map.values()] : []
    setSigns(list.map((d) => ({ id: d.id, text: d.text || '', image: d.image || '' })))
  }

  const deleteSign = (id: string) => {
    ;(getGame() as unknown as { network?: { removeSignboard?: (id: string) => void } })?.network?.removeSignboard?.(id)
    setSigns((prev) => prev.filter((s) => s.id !== id))
  }

  // ダイアログを開くたびに現在値へ同期する
  React.useEffect(() => {
    if (open) {
      setName(currentName)
      setAvatar(currentAvatar)
      refreshSigns()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentName, currentAvatar])

  const copyRoomUrl = () => {
    navigator.clipboard?.writeText(buildRoomUrl(roomKey)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => undefined)
  }

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

        <FieldLabel>表示</FieldLabel>
        <FormControlLabel
          control={
            <Switch
              checked={backgroundMode === BackgroundMode.NIGHT}
              onChange={() => dispatch(toggleBackgroundMode())}
            />
          }
          label={<span style={{ fontSize: 14 }}>背景を夜にする</span>}
        />
        <FormControlLabel
          control={
            <Switch checked={showJoystick} onChange={() => dispatch(setShowJoystick(!showJoystick))} />
          }
          label={<span style={{ fontSize: 14 }}>ジョイスティックを表示（スマホ・タブレット用）</span>}
        />

        <FieldLabel>スタンプ</FieldLabel>
        <Button
          size="small"
          variant="outlined"
          onClick={() => { dispatch(closeSettingsDialog()); dispatch(openStampManager()) }}
        >
          スタンプを管理（{stampCount}個）
        </Button>

        <FieldLabel>設置した画像・看板（{signs.length}）</FieldLabel>
        {signs.length === 0 ? (
          <div style={{ fontSize: 13, color: '#888', padding: '2px 0' }}>設置物はありません</div>
        ) : (
          <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {signs.map((s) => (
              <div
                key={s.id}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', border: '1px solid #ddd', borderRadius: 8 }}
              >
                {s.image ? (
                  <img src={s.image} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, flexShrink: 0, background: '#f0f0f0' }} />
                ) : (
                  <span style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 20 }}>📋</span>
                )}
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.image ? '画像' : (s.text || '(空の看板)')}
                </span>
                <Button size="small" color="error" variant="outlined" onClick={() => deleteSign(s.id)}>
                  削除
                </Button>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 11, color: '#999', margin: '4px 0 4px' }}>
          画面の端にあって押せない画像も、ここから削除できます。
        </div>

        <FieldLabel>ルーム情報</FieldLabel>
        <InfoBox>
          <div className="row"><span className="k">名前:</span><span className="v">{roomName || '—'}</span></div>
          <div className="row"><span className="k">ID:</span><span className="v">{roomId || '—'}</span></div>
          {roomKey && (
            <div className="row"><span className="k">合言葉:</span><span className="v">{roomKey}</span></div>
          )}
          <Button
            size="small"
            variant="outlined"
            onClick={copyRoomUrl}
            style={{ marginTop: 8 }}
          >
            {copied ? 'コピーしました' : '招待URLをコピー'}
          </Button>
        </InfoBox>

        <FieldLabel>操作方法</FieldLabel>
        <GuideList>
          <li><strong>W, A, S, D または 矢印キー</strong> で移動</li>
          <li><strong>E</strong> キーで座る（椅子の前で）</li>
          <li><strong>R</strong> キーで画面共有（コンピュータの前で）</li>
          <li><strong>Enter</strong> キーでチャットを開く</li>
          <li><strong>ESC</strong> キーでチャットを閉じる</li>
          <li>他の人に近づくとビデオ接続が始まります</li>
        </GuideList>
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
