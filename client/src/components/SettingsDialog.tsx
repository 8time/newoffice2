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
import IconButton from '@mui/material/IconButton'
import MicIcon from '@mui/icons-material/Mic'
import MicOffIcon from '@mui/icons-material/MicOff'
import VideocamIcon from '@mui/icons-material/Videocam'
import VideocamOffIcon from '@mui/icons-material/VideocamOff'
import VolumeUpIcon from '@mui/icons-material/VolumeUp'

import { useAppDispatch, useAppSelector } from '../hooks'
import { closeSettingsDialog } from '../stores/SettingsStore'
import { openStampManager } from '../stores/StampStore'
import { setPlayerName, setAvatarName, setShowJoystick, toggleBackgroundMode } from '../stores/UserStore'
import { BackgroundMode } from '../../../types/BackgroundMode'
import { buildRoomUrl } from '../util/roomKey'
import { rememberRoomPassword } from '../util/joinRoom'

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

const MediaBox = styled.div`
  background: rgba(0, 0, 0, 0.04);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const VideoPreviewWrapper = styled.div`
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #1a1a1a;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
`

const VideoPreview = styled.video`
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scaleX(-1);
`

const VideoOverlayNotice = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  gap: 6px;
  pointer-events: none;
`

const PreviewControlRow = styled.div`
  position: absolute;
  bottom: 8px;
  right: 8px;
  display: flex;
  gap: 8px;
  z-index: 2;
`

const DeviceSelect = styled.select`
  width: 100%;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid #ccc;
  background: #fff;
  font-size: 13px;
  color: #333;
  outline: none;
  box-sizing: border-box;
  &:focus {
    border-color: #1976d2;
  }
  &:disabled {
    background: #f5f5f5;
    color: #999;
  }
`

const MeterContainer = styled.div`
  width: 100%;
  height: 10px;
  background: #e0e0e0;
  border-radius: 5px;
  overflow: hidden;
  margin-top: 4px;
`

const MeterBar = styled.div`
  height: 100%;
  width: 0%;
  background: #4caf50;
  border-radius: 5px;
  transition: width 0.05s ease, background-color 0.1s ease;
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
  const roomHasPassword = useAppSelector((state) => state.room.roomHasPassword)
  const [copied, setCopied] = useState(false)
  const [pwInput, setPwInput] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const stampCount = useAppSelector((state) => Object.keys(state.stamp.stamps).length)

  const [name, setName] = useState(currentName)
  const [avatar, setAvatar] = useState(currentAvatar)
  // 設置した看板・画像の一覧（画面端で押せないものもここから削除できる）
  const [signs, setSigns] = useState<Array<{ id: string; text: string; image: string }>>([])

  // カメラ・マイク設定用のステート
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState<string>('')
  const [selectedMicId, setSelectedMicId] = useState<string>('')
  const [hasMediaStream, setHasMediaStream] = useState<boolean>(false)
  const [isVideoOff, setIsVideoOff] = useState<boolean>(false)
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false)
  const [speakerTesting, setSpeakerTesting] = useState<boolean>(false)
  const videoPreviewRef = React.useRef<HTMLVideoElement>(null)
  const meterBarRef = React.useRef<HTMLDivElement>(null)
  const audioContextRef = React.useRef<AudioContext | null>(null)
  const animFrameRef = React.useRef<number | null>(null)

  const getGame = () => phaserGame.scene.keys.game as Game

  // 音声レベルメーターの初期化・更新
  const setupAudioMeter = (stream: MediaStream) => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }

    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) {
      if (meterBarRef.current) meterBarRef.current.style.width = '0%'
      return
    }

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AudioCtx) return
      const audioContext = new AudioCtx()
      audioContextRef.current = audioContext

      if (audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {})
      }

      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)

      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      const updateMeter = () => {
        if (!audioContextRef.current) return
        analyser.getByteFrequencyData(dataArray)
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i]
        }
        const avg = sum / dataArray.length
        const level = Math.min(100, Math.round((avg / 50) * 100))
        if (meterBarRef.current) {
          meterBarRef.current.style.width = `${level}%`
          meterBarRef.current.style.background = level > 70 ? '#f44336' : level > 35 ? '#ff9800' : '#4caf50'
        }
        animFrameRef.current = requestAnimationFrame(updateMeter)
      }
      updateMeter()
    } catch (err) {
      console.error('Failed to setup audio meter:', err)
    }
  }

  const cleanupMediaPreview = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = null
    }
    if (meterBarRef.current) {
      meterBarRef.current.style.width = '0%'
    }
  }

  const refreshMediaState = async () => {
    const game = getGame()
    const webRTC = game?.network?.webRTC

    if (webRTC?.myStream) {
      setHasMediaStream(true)
      setIsVideoOff(webRTC.isVideoOff)
      setIsAudioMuted(webRTC.isAudioMuted)
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = webRTC.myStream
      }
      setupAudioMeter(webRTC.myStream)
    } else {
      setHasMediaStream(false)
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const vList = devices.filter((d) => d.kind === 'videoinput')
      const aList = devices.filter((d) => d.kind === 'audioinput')
      setCameras(vList)
      setMicrophones(aList)

      const curCam = webRTC?.selectedCameraId || (webRTC?.myStream?.getVideoTracks()[0]?.getSettings?.()?.deviceId) || ''
      const curMic = webRTC?.selectedMicId || (webRTC?.myStream?.getAudioTracks()[0]?.getSettings?.()?.deviceId) || ''
      if (curCam) setSelectedCameraId(curCam)
      else if (vList.length > 0) setSelectedCameraId(vList[0].deviceId)

      if (curMic) setSelectedMicId(curMic)
      else if (aList.length > 0) setSelectedMicId(aList[0].deviceId)
    } catch (err) {
      console.error('enumerateDevices error:', err)
    }
  }

  const handleConnectMedia = async () => {
    const game = getGame()
    const webRTC = game?.network?.webRTC
    if (!webRTC) return
    const success = await webRTC.connectMedia(selectedCameraId, selectedMicId)
    if (success) {
      refreshMediaState()
    }
  }

  const handleCameraChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const deviceId = e.target.value
    setSelectedCameraId(deviceId)
    const game = getGame()
    const webRTC = game?.network?.webRTC
    if (webRTC && webRTC.myStream) {
      await webRTC.switchCamera(deviceId)
      if (videoPreviewRef.current && webRTC.myStream) {
        videoPreviewRef.current.srcObject = webRTC.myStream
      }
    }
  }

  const handleMicChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const deviceId = e.target.value
    setSelectedMicId(deviceId)
    const game = getGame()
    const webRTC = game?.network?.webRTC
    if (webRTC && webRTC.myStream) {
      await webRTC.switchMicrophone(deviceId)
      if (webRTC.myStream) {
        setupAudioMeter(webRTC.myStream)
      }
    }
  }

  const toggleVideo = () => {
    const game = getGame()
    const webRTC = game?.network?.webRTC
    if (!webRTC || !webRTC.myStream) return
    const nextVideoOff = !webRTC.isVideoOff
    webRTC.isVideoOff = nextVideoOff
    webRTC.myStream.getVideoTracks().forEach((t) => (t.enabled = !nextVideoOff))
    webRTC.replaceVideoTrackForAllPeers(nextVideoOff ? null : (webRTC.myStream.getVideoTracks()[0] || null))
    setIsVideoOff(nextVideoOff)
    webRTC.notifyVideoState()
  }

  const toggleMic = () => {
    const game = getGame()
    const webRTC = game?.network?.webRTC
    if (!webRTC || !webRTC.myStream) return
    const nextAudioMuted = !webRTC.isAudioMuted
    webRTC.isAudioMuted = nextAudioMuted
    webRTC.myStream.getAudioTracks().forEach((t) => (t.enabled = !nextAudioMuted))
    webRTC.replaceTrackForAllPeers('audio', nextAudioMuted ? null : (webRTC.myStream.getAudioTracks()[0] || null))
    setIsAudioMuted(nextAudioMuted)
    webRTC.notifyVideoState()
  }

  const playSpeakerTest = () => {
    try {
      setSpeakerTesting(true)
      const audio = new Audio('assets/audio/ping.mp3')
      audio.play().then(() => {
        setTimeout(() => setSpeakerTesting(false), 800)
      }).catch((err) => {
        console.warn('Audio play failed, fallback to phaser:', err)
        const game = getGame()
        game?.sound?.play('ping', { volume: 0.5 })
        setTimeout(() => setSpeakerTesting(false), 800)
      })
    } catch (err) {
      console.error('Speaker test failed:', err)
      setSpeakerTesting(false)
    }
  }

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
      refreshMediaState()
    } else {
      cleanupMediaPreview()
    }
    return () => {
      cleanupMediaPreview()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentName, currentAvatar])

  const applyRoomPassword = () => {
    const v = pwInput.trim()
    if (!v || !roomKey) return
    getGame()?.network?.setRoomPassword(v)
    rememberRoomPassword(roomKey, v) // 自分が締め出されないよう覚え直す
    setPwInput('')
    setPwMsg('合言葉を設定しました。友人に新しい合言葉を伝えてください。')
    setTimeout(() => setPwMsg(''), 5000)
  }

  const removeRoomPassword = () => {
    if (!roomKey) return
    getGame()?.network?.setRoomPassword('')
    rememberRoomPassword(roomKey, '')
    setPwMsg('合言葉を解除しました（誰でも入れます）。')
    setTimeout(() => setPwMsg(''), 5000)
  }

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
    <Dialog open={open} onClose={() => dispatch(closeSettingsDialog())} maxWidth="sm" fullWidth>
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

        <FieldLabel>カメラ・マイクの設定</FieldLabel>
        <MediaBox>
          {/* 接続ステータス & 接続ボタン */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: hasMediaStream ? '#4caf50' : '#ffa000',
                  flexShrink: 0,
                }}
              />
              <span style={{ fontWeight: 600, color: hasMediaStream ? '#2e7d32' : '#e65100' }}>
                {hasMediaStream ? 'カメラ・マイク接続中' : 'カメラ・マイク未接続'}
              </span>
            </div>
            {!hasMediaStream && (
              <Button
                size="small"
                variant="contained"
                color="secondary"
                onClick={handleConnectMedia}
                style={{ fontSize: 12 }}
              >
                カメラ・マイクを接続
              </Button>
            )}
          </div>

          {/* カメラ映像プレビュー */}
          <VideoPreviewWrapper>
            <VideoPreview
              ref={videoPreviewRef}
              autoPlay
              playsInline
              muted
              style={{ opacity: isVideoOff || !hasMediaStream ? 0 : 1 }}
            />
            {(!hasMediaStream || isVideoOff) && (
              <VideoOverlayNotice>
                <VideocamOffIcon style={{ fontSize: 36, opacity: 0.7 }} />
                <span>{!hasMediaStream ? 'カメラ未接続' : 'カメラはオフです'}</span>
              </VideoOverlayNotice>
            )}
            {hasMediaStream && (
              <PreviewControlRow>
                <IconButton
                  size="small"
                  onClick={toggleMic}
                  style={{
                    background: isAudioMuted ? '#ea4335' : 'rgba(0, 0, 0, 0.6)',
                    color: '#fff',
                    padding: 6,
                  }}
                  title={isAudioMuted ? 'マイクをミュート解除' : 'マイクをミュート'}
                >
                  {isAudioMuted ? <MicOffIcon fontSize="small" /> : <MicIcon fontSize="small" />}
                </IconButton>
                <IconButton
                  size="small"
                  onClick={toggleVideo}
                  style={{
                    background: isVideoOff ? '#ea4335' : 'rgba(0, 0, 0, 0.6)',
                    color: '#fff',
                    padding: 6,
                  }}
                  title={isVideoOff ? 'カメラをオンにする' : 'カメラをオフにする'}
                >
                  {isVideoOff ? <VideocamOffIcon fontSize="small" /> : <VideocamIcon fontSize="small" />}
                </IconButton>
              </PreviewControlRow>
            )}
          </VideoPreviewWrapper>

          {/* カメラ選択 */}
          <div>
            <div style={{ fontSize: 12, color: '#555', marginBottom: 4, fontWeight: 600 }}>カメラ</div>
            <DeviceSelect
              value={selectedCameraId}
              onChange={handleCameraChange}
              disabled={!hasMediaStream && cameras.length === 0}
            >
              {cameras.length === 0 && <option value="">カメラが見つかりません</option>}
              {cameras.map((c, idx) => (
                <option key={c.deviceId || idx} value={c.deviceId}>
                  {c.label || `カメラ ${idx + 1}`}
                </option>
              ))}
            </DeviceSelect>
          </div>

          {/* マイク選択 */}
          <div>
            <div style={{ fontSize: 12, color: '#555', marginBottom: 4, fontWeight: 600 }}>マイク</div>
            <DeviceSelect
              value={selectedMicId}
              onChange={handleMicChange}
              disabled={!hasMediaStream && microphones.length === 0}
            >
              {microphones.length === 0 && <option value="">マイクが見つかりません</option>}
              {microphones.map((m, idx) => (
                <option key={m.deviceId || idx} value={m.deviceId}>
                  {m.label || `マイク ${idx + 1}`}
                </option>
              ))}
            </DeviceSelect>
          </div>

          {/* マイク入力音量メーター */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#555', marginBottom: 2 }}>
              <span style={{ fontWeight: 600 }}>マイク音量レベル</span>
              <span style={{ color: isAudioMuted ? '#ea4335' : '#888' }}>
                {isAudioMuted ? 'ミュート中' : hasMediaStream ? '音声入力を検知中' : '未接続'}
              </span>
            </div>
            <MeterContainer>
              <MeterBar ref={meterBarRef} />
            </MeterContainer>
          </div>

          {/* スピーカー動作確認 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
            <div style={{ fontSize: 12, color: '#555', fontWeight: 600 }}>スピーカー確認</div>
            <Button
              size="small"
              variant="outlined"
              startIcon={<VolumeUpIcon />}
              onClick={playSpeakerTest}
              disabled={speakerTesting}
              style={{ fontSize: 12 }}
            >
              {speakerTesting ? '再生中...' : 'テスト音を再生'}
            </Button>
          </div>
        </MediaBox>

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

        {/* 固定ルーム（合言葉ルーム）だけ、入室パスワードを変更できる */}
        {roomKey && (
          <>
            <FieldLabel>入室パスワード（合言葉）</FieldLabel>
            <div style={{ fontSize: 12, color: roomHasPassword ? '#1a6b2a' : '#888', marginBottom: 6 }}>
              現在: {roomHasPassword ? '🔒 設定あり（合言葉を知っている人だけ入れます）' : 'なし（このURLを知っていれば誰でも入れます）'}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <TextField
                size="small"
                fullWidth
                variant="outlined"
                placeholder="新しい合言葉を入力"
                value={pwInput}
                onChange={(e) => setPwInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applyRoomPassword() }}
                inputProps={{ maxLength: 40 }}
              />
              <Button variant="contained" color="secondary" onClick={applyRoomPassword} disabled={!pwInput.trim()}>
                {roomHasPassword ? '変更' : '設定'}
              </Button>
            </div>
            {roomHasPassword && (
              <Button size="small" color="error" onClick={removeRoomPassword} style={{ marginTop: 6 }}>
                合言葉を解除する
              </Button>
            )}
            {pwMsg && <div style={{ fontSize: 12, color: '#1a6b2a', marginTop: 6 }}>{pwMsg}</div>}
            <div style={{ fontSize: 11, color: '#999', marginTop: 4, lineHeight: 1.6 }}>
              合言葉を変えても、部屋の中身（チャット・看板・伝言板・マップ配置など）はそのまま残ります。
              変更すると古い合言葉では入れなくなるので、新しい合言葉を友人に伝えてください。
            </div>
          </>
        )}

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
