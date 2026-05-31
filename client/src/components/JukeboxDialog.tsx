import React, { useEffect, useRef } from 'react'
import styled from 'styled-components'
import {
  IconButton,
  Dialog,
  DialogContent,
  Typography,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Button,
  FormControlLabel,
  Switch,
  Slider,
  Box,
} from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import PauseIcon from '@mui/icons-material/Pause'
import StopIcon from '@mui/icons-material/Stop'
import SkipNextIcon from '@mui/icons-material/SkipNext'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import CloseIcon from '@mui/icons-material/Close'
import MusicNoteIcon from '@mui/icons-material/MusicNote'

import { useAppSelector, useAppDispatch } from '../hooks'
import {
  closeJukeboxDialog,
  playSongByIndex,
  addSongToPlaylist,
  toggleRepeat,
  setVolume,
  setPlaylist,
} from '../stores/JukeboxStore'
import { phaserEvents, Event } from '../events/EventCenter'

const NeonWrapper = styled(Box)`
  background: rgba(10, 18, 30, 0.85);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(0, 180, 255, 0.35);
  border-radius: 16px;
  box-shadow: 0 0 25px rgba(0, 150, 255, 0.25);
  color: #e0f2fe;
  font-family: 'Outfit', sans-serif;
  padding: 16px;
`

const JukeboxHeader = styled(Box)`
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(0, 180, 255, 0.2);
  padding-bottom: 12px;
  margin-bottom: 16px;
`

const GlassButton = styled(IconButton)`
  background: rgba(0, 150, 255, 0.1) !important;
  border: 1px solid rgba(0, 150, 255, 0.25) !important;
  color: #38bdf8 !important;
  margin: 0 8px !important;
  transition: all 0.2s ease-in-out !important;

  &:hover {
    background: rgba(0, 150, 255, 0.25) !important;
    box-shadow: 0 0 10px rgba(0, 150, 255, 0.5) !important;
    transform: scale(1.08);
  }
`

const MainPlayButton = styled(GlassButton)`
  background: rgba(0, 255, 136, 0.1) !important;
  border: 1px solid rgba(0, 255, 136, 0.3) !important;
  color: #00ff88 !important;

  &:hover {
    background: rgba(0, 255, 136, 0.25) !important;
    box-shadow: 0 0 12px rgba(0, 255, 136, 0.6) !important;
  }
`

const SongListContainer = styled(Box)`
  max-height: 200px;
  overflow-y: auto;
  margin-top: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);

  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(0, 150, 255, 0.3);
    border-radius: 4px;
  }
`

const SongListItem = styled(ListItem)<{ active: number }>`
  background: ${(props) => (props.active ? 'rgba(0, 150, 255, 0.15)' : 'transparent')};
  border-left: ${(props) => (props.active ? '3px solid #38bdf8' : '3px solid transparent')};
  transition: all 0.2s;
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.05);
  }
`

export default function JukeboxDialog() {
  const dispatch = useAppDispatch()
  const open = useAppSelector((state) => state.jukebox.jukeboxDialogOpen)
  const playing = useAppSelector((state) => state.jukebox.playing)
  const paused = useAppSelector((state) => state.jukebox.paused)
  const currentSongName = useAppSelector((state) => state.jukebox.currentSongName)
  const currentSongIndex = useAppSelector((state) => state.jukebox.currentSongIndex)
  const repeat = useAppSelector((state) => state.jukebox.repeat)
  const playlist = useAppSelector((state) => state.jukebox.playlist)
  const volume = useAppSelector((state) => state.jukebox.volume)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleVolumeChange = (_event: any, newValue: number | number[]) => {
    const vol = newValue as number
    dispatch(setVolume(vol))
    phaserEvents.emit(Event.JUKEBOX_VOLUME, vol)
  }

  // ダイアログが開いた際にサーバーから最新の mp3 ファイルリストをフェッチして同期
  useEffect(() => {
    if (!open) return

    const host = window.location.hostname
    fetch(`http://${host}:2567/api/audio-list`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          dispatch(setPlaylist(data))
        }
      })
      .catch((err) => {
        console.error('Failed to fetch audio list from server:', err)
      })
  }, [open, dispatch])

  // Phaser からの「曲終了」イベントを監視して自動次の曲へ
  useEffect(() => {
    const handleJukeboxStateUpdate = (data: { status: string }) => {
      if (data.status === 'complete') {
        playNext()
      }
    }

    phaserEvents.on(Event.JUKEBOX_STATE_UPDATE, handleJukeboxStateUpdate)
    return () => {
      phaserEvents.off(Event.JUKEBOX_STATE_UPDATE, handleJukeboxStateUpdate)
    }
  }, [playlist, currentSongIndex, repeat])

  // 再生を Phaser に伝える
  const playSong = (index: number) => {
    if (index >= 0 && index < playlist.length) {
      dispatch(playSongByIndex(index))
      const song = playlist[index]
      phaserEvents.emit(Event.JUKEBOX_PLAY, {
        name: song.name,
        url: song.url,
        isLocal: song.isLocal,
        index: index,
      })
    }
  }

  const handlePlayPause = () => {
    if (playing) {
      phaserEvents.emit(Event.JUKEBOX_PAUSE)
    } else if (paused && currentSongIndex >= 0) {
      playSong(currentSongIndex)
    } else {
      playSong(0) // 何も再生してなければ最初の曲を
    }
  }

  const handleStop = () => {
    phaserEvents.emit(Event.JUKEBOX_STOP)
  }

  const playNext = () => {
    if (playlist.length === 0) return
    let nextIdx = currentSongIndex + 1
    if (nextIdx >= playlist.length) {
      nextIdx = repeat ? 0 : -1 // リピートONなら最初に戻り、OFFなら停止
    }
    if (nextIdx >= 0) {
      playSong(nextIdx)
    } else {
      handleStop()
    }
  }

  const handleRepeatChange = () => {
    dispatch(toggleRepeat())
    phaserEvents.emit(Event.JUKEBOX_REPEAT, !repeat)
  }

  // ローカル mp3 のアップロード・プレイリスト追加
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // ローカル一時URLの生成
    const fileURL = URL.createObjectURL(file)
    const newSong = {
      name: file.name.replace(/\.[^/.]+$/, ""), // 拡張子削除
      url: fileURL,
      isLocal: true,
    }

    dispatch(addSongToPlaylist(newSong))
    
    // 追加した曲を即再生
    setTimeout(() => {
      playSong(playlist.length) // 追加前の長さがそのまま追加後のインデックスになる
    }, 100)
  }

  return (
    <Dialog
      open={open}
      onClose={() => dispatch(closeJukeboxDialog())}
      PaperProps={{
        style: {
          backgroundColor: 'transparent',
          boxShadow: 'none',
          maxWidth: '450px',
          width: '100%',
        },
      }}
    >
      <NeonWrapper>
        <JukeboxHeader>
          <Box display="flex" alignItems="center">
            <MusicNoteIcon style={{ color: '#00b4ff', marginRight: '8px', fontSize: '24px' }} />
            <Typography variant="h6" style={{ fontWeight: 'bold', letterSpacing: '1px' }}>
              BGM JUKEBOX
            </Typography>
          </Box>
          <IconButton onClick={() => dispatch(closeJukeboxDialog())} style={{ color: '#e0f2fe' }}>
            <CloseIcon />
          </IconButton>
        </JukeboxHeader>

        {/* 再生状態ディスプレイ */}
        <Box
          style={{
            background: 'rgba(0, 0, 0, 0.4)',
            border: '1px solid rgba(0, 180, 255, 0.2)',
            borderRadius: '10px',
            padding: '16px',
            textAlign: 'center',
            marginBottom: '20px',
            boxShadow: 'inset 0 0 10px rgba(0, 0, 0, 0.5)',
          }}
        >
          <Typography variant="body2" style={{ color: '#38bdf8', fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase' }}>
            {playing ? '🔊 Now Playing' : paused ? '⏸️ Paused' : '⏹️ Stopped'}
          </Typography>
          <Typography
            variant="body1"
            style={{
              fontWeight: 'bold',
              marginTop: '6px',
              fontSize: '16px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              textShadow: playing ? '0 0 8px rgba(56, 189, 248, 0.6)' : 'none',
            }}
          >
            {currentSongName || 'No track selected'}
          </Typography>
        </Box>

        {/* コントロールパネル */}
        <Box display="flex" justifyContent="center" alignItems="center" my={2}>
          <GlassButton onClick={handleStop} disabled={!playing && !paused} title="Stop">
            <StopIcon />
          </GlassButton>
          <MainPlayButton onClick={handlePlayPause} title={playing ? "Pause" : "Play"}>
            {playing ? <PauseIcon fontSize="large" /> : <PlayArrowIcon fontSize="large" />}
          </MainPlayButton>
          <GlassButton onClick={playNext} disabled={playlist.length <= 1} title="Next Track">
            <SkipNextIcon />
          </GlassButton>
        </Box>

        {/* 音量調整スライダー */}
        <Box display="flex" alignItems="center" px={2} mt={1} mb={2}>
          <Typography variant="body2" style={{ color: '#38bdf8', minWidth: '50px', fontSize: '12px' }}>
            Volume
          </Typography>
          <Slider
            value={volume}
            min={0}
            max={1}
            step={0.05}
            onChange={handleVolumeChange}
            style={{ color: '#38bdf8', marginLeft: '12px', flex: 1 }}
          />
          <Typography variant="body2" style={{ color: '#38bdf8', minWidth: '35px', textAlign: 'right', fontSize: '12px', marginLeft: '8px' }}>
            {Math.round(volume * 100)}%
          </Typography>
        </Box>

        <Box display="flex" justifyContent="space-between" alignItems="center" mt={2} px={1}>
          <FormControlLabel
            control={
              <Switch
                checked={repeat}
                onChange={handleRepeatChange}
                color="primary"
                size="small"
              />
            }
            label={
              <Typography style={{ fontSize: '13px', color: repeat ? '#00ff88' : '#94a3b8' }}>
                🔁 Loop Repeat
              </Typography>
            }
          />

          {/* アップロードボタン */}
          <Button
            variant="outlined"
            component="label"
            startIcon={<CloudUploadIcon />}
            style={{
              borderColor: 'rgba(0, 180, 255, 0.4)',
              color: '#38bdf8',
              fontSize: '11px',
              padding: '4px 12px',
              borderRadius: '20px',
              background: 'rgba(0, 150, 255, 0.05)',
              textTransform: 'none',
            }}
          >
            Add MP3
            <input
              type="file"
              accept="audio/mp3"
              hidden
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
          </Button>
        </Box>

        {/* プレイリスト */}
        <Typography variant="subtitle2" style={{ marginTop: '20px', fontWeight: 'bold', color: '#94a3b8', fontSize: '12px' }}>
          PLAYLIST ({playlist.length})
        </Typography>
        <SongListContainer>
          <List dense disablePadding>
            {playlist.map((song, index) => {
              const isActive = currentSongIndex === index
              return (
                <SongListItem
                  key={index}
                  active={isActive ? 1 : 0}
                  onClick={() => playSong(index)}
                >
                  <ListItemText
                    primary={song.name}
                    primaryTypographyProps={{
                      style: {
                        color: isActive ? '#00ff88' : '#e0f2fe',
                        fontWeight: isActive ? 'bold' : 'normal',
                        fontSize: '13px',
                      },
                    }}
                    secondary={song.isLocal ? 'Uploaded' : 'Default BGM'}
                    secondaryTypographyProps={{
                      style: {
                        color: isActive ? 'rgba(0, 255, 136, 0.6)' : 'rgba(224, 242, 254, 0.4)',
                        fontSize: '10px',
                      },
                    }}
                  />
                  {isActive && playing && (
                    <ListItemSecondaryAction>
                      <MusicNoteIcon style={{ color: '#00ff88', fontSize: '16px' }} />
                    </ListItemSecondaryAction>
                  )}
                </SongListItem>
              )
            })}
          </List>
        </SongListContainer>
      </NeonWrapper>
    </Dialog>
  )
}
