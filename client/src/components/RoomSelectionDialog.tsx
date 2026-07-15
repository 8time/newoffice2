import React, { useState } from 'react'
import logo from '../images/logo.png'
import styled from 'styled-components'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import LinearProgress from '@mui/material/LinearProgress'
import Alert from '@mui/material/Alert'
import Snackbar from '@mui/material/Snackbar'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'

import TextField from '@mui/material/TextField'

import { CustomRoomTable } from './CustomRoomTable'
import { CreateRoomForm } from './CreateRoomForm'
import { useAppSelector, useAppDispatch } from '../hooks'
import { setRoomKey } from '../stores/RoomStore'
import { normalizeRoomKey, setRoomKeyInUrl } from '../util/roomKey'

import phaserGame from '../PhaserGame'
import Bootstrap from '../scenes/Bootstrap'

const Backdrop = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  /* ユーザーの要望に合わせて全体を2倍に拡大 */
  transform: translate(-50%, -50%) scale(2);
  display: flex;
  flex-direction: column;
  gap: 60px;
  align-items: center;
`

const Wrapper = styled.div`
  background: #222639;
  border-radius: 16px;
  padding: 36px 60px;
  box-shadow: 0px 0px 5px #0000006f;
`

const CustomRoomWrapper = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 20px;
  align-items: center;
  justify-content: center;

  .tip {
    font-size: 18px;
  }
`

const TitleWrapper = styled.div`
  display: grid;
  width: 100%;

  .back-button {
    grid-column: 1;
    grid-row: 1;
    justify-self: start;
    align-self: center;
  }

  h1 {
    grid-column: 1;
    grid-row: 1;
    justify-self: center;
    align-self: center;
  }
`

const Title = styled.h1`
  font-size: 24px;
  color: #eee;
  text-align: center;
`

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin: 20px 0;
  align-items: center;
  justify-content: center;

  img {
    border-radius: 8px;
    height: 120px;
  }
`

const ProgressBarWrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;

  h3 {
    color: #33ac96;
  }
`

const ProgressBar = styled(LinearProgress)`
  width: 360px;
`

const FixedRoomBox = styled.div`
  margin-top: 8px;
  padding-top: 16px;
  border-top: 1px solid #ffffff22;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 320px;

  .label {
    font-size: 14px;
    color: #eee;
    text-align: center;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .hint {
    font-size: 11px;
    color: #9a9a9a;
    line-height: 1.4;
  }
`

export default function RoomSelectionDialog() {
  const [showCustomRoom, setShowCustomRoom] = useState(false)
  const [showCreateRoomForm, setShowCreateRoomForm] = useState(false)
  const [showSnackbar, setShowSnackbar] = useState(false)
  const [fixedRoomInput, setFixedRoomInput] = useState('')
  const lobbyJoined = useAppSelector((state) => state.room.lobbyJoined)
  const dispatch = useAppDispatch()

  const handleConnect = () => {
    if (lobbyJoined) {
      const bootstrap = phaserGame.scene.keys.bootstrap as Bootstrap
      bootstrap.network
        .joinOrCreatePublic()
        .then(() => bootstrap.launchGame())
        .catch((error) => console.error(error))
    } else {
      setShowSnackbar(true)
    }
  }

  // 合言葉で固定ルームに入る（同じ合言葉なら常に同じ部屋）。入室後URLに ?room= を反映する
  const handleEnterFixedRoom = () => {
    const key = normalizeRoomKey(fixedRoomInput)
    if (!key) return
    if (!lobbyJoined) {
      setShowSnackbar(true)
      return
    }
    const bootstrap = phaserGame.scene.keys.bootstrap as Bootstrap
    bootstrap.network
      .joinOrCreateKeyed(key)
      .then(() => {
        dispatch(setRoomKey(key))
        setRoomKeyInUrl(key)
        bootstrap.launchGame()
      })
      .catch((error) => console.error(error))
  }

  return (
    <>
      <Snackbar
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        open={showSnackbar}
        autoHideDuration={3000}
        onClose={() => {
          setShowSnackbar(false)
        }}
      >
        <Alert
          severity="error"
          variant="outlined"
          // overwrites the dark theme on render
          style={{ background: '#fdeded', color: '#7d4747' }}
        >
          サーバーに接続中、もう一度お試しください！
        </Alert>
      </Snackbar>
      <Backdrop>
        <Wrapper>
          {showCreateRoomForm ? (
            <CustomRoomWrapper>
              <TitleWrapper>
                <IconButton className="back-button" onClick={() => setShowCreateRoomForm(false)}>
                  <ArrowBackIcon />
                </IconButton>
                <Title>カスタムルームを作成</Title>
              </TitleWrapper>
              <CreateRoomForm />
            </CustomRoomWrapper>
          ) : showCustomRoom ? (
            <CustomRoomWrapper>
              <TitleWrapper>
                <IconButton className="back-button" onClick={() => setShowCustomRoom(false)}>
                  <ArrowBackIcon />
                </IconButton>
                <Title>
                  カスタムルーム
                  <Tooltip
                    title="結果はリアルタイムで更新されます。リロードは不要です！"
                    placement="top"
                  >
                    <IconButton>
                      <HelpOutlineIcon className="tip" />
                    </IconButton>
                  </Tooltip>
                </Title>
              </TitleWrapper>
              <CustomRoomTable />
              <Button
                variant="contained"
                color="secondary"
                onClick={() => setShowCreateRoomForm(true)}
              >
                新しくルームを作成
              </Button>
            </CustomRoomWrapper>
          ) : (
            <>
              <Title>SkyOfficeへようこそ</Title>
              <Content>
                <img src={logo} alt="logo" />
                <Button variant="contained" color="secondary" onClick={handleConnect}>
                  パブリックロビーに接続
                </Button>
                <Button
                  variant="outlined"
                  color="secondary"
                  onClick={() => (lobbyJoined ? setShowCustomRoom(true) : setShowSnackbar(true))}
                >
                  ルームを作成・探す
                </Button>

                {/* 合言葉で入る固定ルーム。同じ合言葉なら毎回同じ部屋に入れる（URL共有可） */}
                <FixedRoomBox>
                  <div className="label">合言葉で固定ルームに入る</div>
                  <div className="row">
                    <TextField
                      size="small"
                      variant="outlined"
                      color="secondary"
                      placeholder="例: eigyou-team"
                      value={fixedRoomInput}
                      onChange={(e) => setFixedRoomInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleEnterFixedRoom() }}
                    />
                    <Button
                      variant="contained"
                      color="secondary"
                      disabled={!normalizeRoomKey(fixedRoomInput)}
                      onClick={handleEnterFixedRoom}
                    >
                      入る
                    </Button>
                  </div>
                  <div className="hint">同じ合言葉を入れた人と同じ部屋になります。入室後のURLをブックマークすればワンクリックで入れます。</div>
                </FixedRoomBox>
              </Content>
            </>
          )}
        </Wrapper>
        {!lobbyJoined && (
          <ProgressBarWrapper>
            <h3> サーバーに接続中...</h3>
            <ProgressBar color="secondary" />
          </ProgressBarWrapper>
        )}
      </Backdrop>
    </>
  )
}
