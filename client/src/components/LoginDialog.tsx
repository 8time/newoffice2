import React, { useState } from 'react'
import styled from 'styled-components'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Avatar from '@mui/material/Avatar'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import ArrowRightIcon from '@mui/icons-material/ArrowRight'
import FormControlLabel from '@mui/material/FormControlLabel'
import Checkbox from '@mui/material/Checkbox'
import IconButton from '@mui/material/IconButton'
import MicIcon from '@mui/icons-material/Mic'
import MicOffIcon from '@mui/icons-material/MicOff'
import VideocamIcon from '@mui/icons-material/Videocam'
import VideocamOffIcon from '@mui/icons-material/VideocamOff'

import { Swiper, SwiperSlide } from 'swiper/react'
import { Navigation } from 'swiper'
import 'swiper/css'
import 'swiper/css/navigation'

import Adam from '../images/login/Adam_login.png'
import Ash from '../images/login/Ash_login.png'
import Lucy from '../images/login/Lucy_login.png'
import Nancy from '../images/login/Nancy_login.png'
import { useAppSelector, useAppDispatch } from '../hooks'
import { setLoggedIn, setAvatarName, setPlayerName, setVideoConnected } from '../stores/UserStore'
import { getAvatarString, getColorByString } from '../util'

import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'

const Wrapper = styled.form`
  position: fixed;
  top: 50%;
  left: 50%;
  /* サイズが大きすぎるとのことなので、1.2倍程度に縮小（元は2倍） */
  transform: translate(-50%, -50%) scale(1.2);
  background: #222639;
  border-radius: 16px;
  padding: 36px 60px;
  box-shadow: 0px 0px 5px #0000006f;
`

const Title = styled.p`
  margin: 5px;
  font-size: 20px;
  color: #c2c2c2;
  text-align: center;
`

const RoomName = styled.div`
  max-width: 500px;
  max-height: 120px;
  overflow-wrap: anywhere;
  overflow-y: auto;
  display: flex;
  gap: 10px;
  justify-content: center;
  align-items: center;

  h3 {
    font-size: 24px;
    color: #eee;
  }
`

const RoomDescription = styled.div`
  max-width: 500px;
  max-height: 150px;
  overflow-wrap: anywhere;
  overflow-y: auto;
  font-size: 16px;
  color: #c2c2c2;
  display: flex;
  justify-content: center;
`

const SubTitle = styled.h3`
  width: 160px;
  font-size: 16px;
  color: #eee;
  text-align: center;
`

const Content = styled.div`
  display: flex;
  margin: 36px 0;
`

const Left = styled.div`
  margin-right: 48px;

  --swiper-navigation-size: 24px;

  .swiper {
    width: 160px;
    height: 220px;
    border-radius: 8px;
    overflow: hidden;
  }

  .swiper-slide {
    width: 160px;
    height: 220px;
    background: #dbdbe0;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .swiper-slide img {
    display: block;
    width: 95px;
    height: 136px;
    object-fit: contain;
  }
`

const Right = styled.div`
  width: 300px;
`

const Bottom = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
`

const Warning = styled.div`
  margin-top: 30px;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 3px;
`

const avatars = [
  { name: 'adam', img: Adam },
  { name: 'ash', img: Ash },
  { name: 'lucy', img: Lucy },
  { name: 'nancy', img: Nancy },
]

// shuffle the avatars array
for (let i = avatars.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1))
  ;[avatars[i], avatars[j]] = [avatars[j], avatars[i]]
}

export default function LoginDialog() {
  const [name, setName] = useState<string>(() => localStorage.getItem('skyoffice_playerName') || '')
  const [avatarIndex, setAvatarIndex] = useState<number>(() => {
    const savedAvatar = localStorage.getItem('skyoffice_avatarName')
    if (savedAvatar) {
      const idx = avatars.findIndex((a) => a.name === savedAvatar)
      if (idx !== -1) return idx
    }
    return 0
  })
  const [autoLogin, setAutoLogin] = useState<boolean>(() => localStorage.getItem('skyoffice_autoLogin_v3') === 'true')
  const [nameFieldEmpty, setNameFieldEmpty] = useState<boolean>(false)

  // 追加: メディアストリームとデバイス一覧のステート
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState<string>('')
  const [selectedMicId, setSelectedMicId] = useState<string>('')
  const [isMicMuted, setIsMicMuted] = useState<boolean>(() => localStorage.getItem('skyoffice_micMuted') === 'true')
  const [isVideoOff, setIsVideoOff] = useState<boolean>(() => localStorage.getItem('skyoffice_videoOff') === 'true')
  const videoRef = React.useRef<HTMLVideoElement>(null)

  const toggleMic = () => {
    const newState = !isMicMuted
    setIsMicMuted(newState)
    localStorage.setItem('skyoffice_micMuted', newState ? 'true' : 'false')
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !newState
      })
    }
  }

  const toggleVideo = () => {
    const newState = !isVideoOff
    setIsVideoOff(newState)
    localStorage.setItem('skyoffice_videoOff', newState ? 'true' : 'false')
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !newState
      })
    }
  }

  const dispatch = useAppDispatch()
  const videoConnected = useAppSelector((state) => state.user.videoConnected)
  const roomJoined = useAppSelector((state) => state.room.roomJoined)
  const roomName = useAppSelector((state) => state.room.roomName)
  const roomDescription = useAppSelector((state) => state.room.roomDescription)
  const game = phaserGame.scene.keys.game as Game

  const getMedia = async (cameraId?: string, micId?: string) => {
    try {
      const constraints: MediaStreamConstraints = {
        video: cameraId ? { deviceId: { exact: cameraId } } : true,
        audio: micId ? { deviceId: { exact: micId } } : true,
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      
      // 以前のストリームがあれば止める
      if (localStream && (localStream !== stream)) {
        localStream.getTracks().forEach(track => track.stop())
      }
      
      setLocalStream(stream)
      
      // 既存のミュート設定をストリームに反映
      stream.getAudioTracks().forEach(track => track.enabled = !isMicMuted)
      stream.getVideoTracks().forEach(track => track.enabled = !isVideoOff)

      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }

      // デバイス一覧を取得
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoDevices = devices.filter((d) => d.kind === 'videoinput')
      const audioDevices = devices.filter((d) => d.kind === 'audioinput')
      setCameras(videoDevices)
      setMicrophones(audioDevices)

      // 初回なら選択中IDをセット
      if (!cameraId && videoDevices.length > 0) {
        const currentVideoTrack = stream.getVideoTracks()[0]
        if (currentVideoTrack) {
          const matchedDevice = videoDevices.find(d => d.label === currentVideoTrack.label)
          setSelectedCameraId(matchedDevice?.deviceId || videoDevices[0].deviceId)
        }
      } else if (cameraId) {
        setSelectedCameraId(cameraId)
      }

      if (!micId && audioDevices.length > 0) {
        const currentAudioTrack = stream.getAudioTracks()[0]
        if (currentAudioTrack) {
          const matchedDevice = audioDevices.find(d => d.label === currentAudioTrack.label)
          setSelectedMicId(matchedDevice?.deviceId || audioDevices[0].deviceId)
        }
      } else if (micId) {
        setSelectedMicId(micId)
      }
    } catch (err) {
      window.alert('ウェブカムまたはマイクが見つからないか、許可がブロックされています')
    }
  }

  const joinRoom = () => {
    const game = phaserGame.scene.keys.game as Game
    // Phaserのシーン生成が完了する（myPlayerが作成される）まで待つ
    if (!game || !game.myPlayer) {
      setTimeout(joinRoom, 50)
      return
    }

    console.log('Join! Name:', name, 'Avatar:', avatars[avatarIndex].name)
    localStorage.setItem('skyoffice_playerName', name)
    localStorage.setItem('skyoffice_avatarName', avatars[avatarIndex].name)
    localStorage.setItem('skyoffice_autoLogin_v3', autoLogin ? 'true' : 'false')

    game.registerKeys()
    game.myPlayer.setPlayerName(name)
    game.myPlayer.setPlayerTexture(avatars[avatarIndex].name)

    // 取得済みのストリームがあればWebRTCへ渡す
    if (localStream) {
      if (game.network.webRTC) {
        game.network.webRTC.isAudioMuted = isMicMuted
        game.network.webRTC.isVideoOff = isVideoOff
        game.network.webRTC.setMediaStream(localStream)
      }
      dispatch(setVideoConnected(true))
    }

    game.network.readyToConnect()
    dispatch(setAvatarName(avatars[avatarIndex].name))
    dispatch(setPlayerName(name))
    dispatch(setLoggedIn(true))
  }

  // 自動ログインチェック
  React.useEffect(() => {
    if (roomJoined && autoLogin && name !== '') {
      joinRoom()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomJoined])

  // 過去に許可されている場合は自動でデバイスを取得してプレビューを表示する
  React.useEffect(() => {
    const permissionName = 'microphone' as PermissionName
    navigator.permissions?.query({ name: permissionName }).then((result) => {
      if (result.state === 'granted') {
        getMedia()
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (name === '') {
      setNameFieldEmpty(true)
    } else if (roomJoined) {
      joinRoom()
    }
  }

  return (
    <Wrapper onSubmit={handleSubmit}>
      <Title>入室中</Title>
      <RoomName>
        <Avatar style={{ background: getColorByString(roomName) }}>
          {getAvatarString(roomName)}
        </Avatar>
        <h3>{roomName}</h3>
      </RoomName>
      <RoomDescription>
        <ArrowRightIcon /> {roomDescription}
      </RoomDescription>
      <Content>
        <Left>
          <SubTitle>アバターを選択</SubTitle>
          <Swiper
            modules={[Navigation]}
            navigation
            initialSlide={avatarIndex}
            spaceBetween={0}
            slidesPerView={1}
            onSlideChange={(swiper) => {
              setAvatarIndex(swiper.activeIndex)
            }}
          >
            {avatars.map((avatar) => (
              <SwiperSlide key={avatar.name}>
                <img src={avatar.img} alt={avatar.name} />
              </SwiperSlide>
            ))}
          </Swiper>
        </Left>
        <Right>
          <TextField
            autoFocus={!autoLogin}
            fullWidth
            label="名前"
            variant="outlined"
            color="secondary"
            value={name}
            error={nameFieldEmpty}
            helperText={nameFieldEmpty && '名前を入力してください'}
            onInput={(e) => {
              setName((e.target as HTMLInputElement).value)
            }}
          />
          {!localStream && !videoConnected && (
            <Warning>
              <Alert variant="outlined" severity="warning">
                <AlertTitle>警告</AlertTitle>
                カメラ/マイクが接続されていません。最高の体験のために接続をおすすめします！
              </Alert>
              <Button
                variant="outlined"
                color="secondary"
                onClick={() => getMedia()}
              >
                Connect Webcam
              </Button>
            </Warning>
          )}

          {localStream && !videoConnected && (
            <Warning style={{ alignItems: 'center' }}>
              <div style={{ position: 'relative', width: '100%', borderRadius: 8, overflow: 'hidden', background: '#000', aspectRatio: '4/3' }}>
                {isVideoOff && (
                  <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                    カメラはオフです
                  </div>
                )}
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover', transform: 'scaleX(-1)', opacity: isVideoOff ? 0 : 1 }}
                />
                <div style={{ position: 'absolute', bottom: 8, right: 8, display: 'flex', gap: 8 }}>
                  <IconButton
                    size="small"
                    style={{ background: isMicMuted ? '#ea4335' : 'rgba(255, 255, 255, 0.2)', color: '#fff' }}
                    onClick={toggleMic}
                  >
                    {isMicMuted ? <MicOffIcon /> : <MicIcon />}
                  </IconButton>
                  <IconButton
                    size="small"
                    style={{ background: isVideoOff ? '#ea4335' : 'rgba(255, 255, 255, 0.2)', color: '#fff' }}
                    onClick={toggleVideo}
                  >
                    {isVideoOff ? <VideocamOffIcon /> : <VideocamIcon />}
                  </IconButton>
                </div>
              </div>
              <div style={{ width: '100%', marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <select
                  value={selectedCameraId}
                  onChange={(e) => getMedia(e.target.value, selectedMicId)}
                  style={{ padding: 8, borderRadius: 4, background: '#333', color: '#fff', border: '1px solid #555' }}
                >
                  {cameras.length === 0 && <option value="">カメラが見つかりません</option>}
                  {cameras.map(c => <option key={c.deviceId} value={c.deviceId}>{c.label || `Camera ${c.deviceId.slice(0, 5)}`}</option>)}
                </select>
                <select
                  value={selectedMicId}
                  onChange={(e) => getMedia(selectedCameraId, e.target.value)}
                  style={{ padding: 8, borderRadius: 4, background: '#333', color: '#fff', border: '1px solid #555' }}
                >
                  {microphones.length === 0 && <option value="">マイクが見つかりません</option>}
                  {microphones.map(m => <option key={m.deviceId} value={m.deviceId}>{m.label || `Microphone ${m.deviceId.slice(0, 5)}`}</option>)}
                </select>
              </div>
            </Warning>
          )}

          {videoConnected && (
            <Warning>
              <Alert variant="outlined">カメラが接続されました！</Alert>
            </Warning>
          )}

          <div style={{ marginTop: '16px' }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={autoLogin}
                  onChange={(e) => setAutoLogin(e.target.checked)}
                  color="secondary"
                />
              }
              label="次回から自動でログインする"
              style={{ color: '#eee' }}
            />
          </div>
        </Right>
      </Content>
      <Bottom>
        <Button variant="contained" color="secondary" size="large" type="submit">
          入室する
        </Button>
      </Bottom>
    </Wrapper>
  )
}
