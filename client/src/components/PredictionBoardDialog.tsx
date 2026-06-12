import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import {
  IconButton,
  Dialog,
  Typography,
  Box,
  CircularProgress,
  TextField,
  Button,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents'
import ForumIcon from '@mui/icons-material/Forum'
import SendIcon from '@mui/icons-material/Send'
import SchoolIcon from '@mui/icons-material/School'

import { useAppSelector, useAppDispatch } from '../hooks'
import {
  closePredictionBoardDialog,
  setAgentState,
  setLoading,
} from '../stores/PredictionBoardStore'

const NeonWrapper = styled(Box)`
  background: rgba(10, 18, 30, 0.95);
  backdrop-filter: blur(14px);
  border: 2px solid rgba(255, 180, 0, 0.5);
  border-radius: 20px;
  box-shadow: 0 0 40px rgba(255, 150, 0, 0.3);
  color: #e0f2fe;
  font-family: 'Outfit', sans-serif;
  padding: 28px 32px;
  max-height: 80vh;
  overflow-y: auto;
  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-thumb { background: rgba(255, 180, 0, 0.3); border-radius: 4px; }
`

const Header = styled(Box)`
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 2px solid rgba(255, 180, 0, 0.3);
  padding-bottom: 16px;
  margin-bottom: 20px;
`

const MissionBox = styled(Box)`
  background: linear-gradient(135deg, rgba(100, 50, 255, 0.15), rgba(56, 189, 248, 0.1));
  border: 2px solid rgba(100, 80, 255, 0.4);
  border-radius: 14px;
  padding: 18px 20px;
  margin-bottom: 20px;
`

const ActiveMissionBanner = styled(Box)`
  background: rgba(100, 50, 255, 0.12);
  border: 1px solid rgba(100, 80, 255, 0.3);
  border-radius: 10px;
  padding: 12px 16px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 10px;
`

const ConsensusBanner = styled(Box)`
  background: linear-gradient(135deg, rgba(255, 180, 0, 0.15), rgba(255, 100, 0, 0.1));
  border: 1px solid rgba(255, 180, 0, 0.3);
  border-radius: 12px;
  padding: 14px 18px;
  margin-bottom: 20px;
  text-align: center;
`

const BotCard = styled(Box)`
  background: rgba(0, 0, 0, 0.4);
  border: 2px solid rgba(255, 180, 0, 0.25);
  border-radius: 14px;
  padding: 18px 22px;
  margin-bottom: 14px;
  transition: all 0.2s;
  &:hover {
    border-color: rgba(255, 180, 0, 0.6);
    box-shadow: 0 0 16px rgba(255, 150, 0, 0.2);
  }
`

const DebateCard = styled(Box)`
  background: rgba(0, 50, 100, 0.2);
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: 12px;
  padding: 16px 20px;
  margin-bottom: 12px;
`

const DebateExchange = styled(Box)`
  padding: 6px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  &:last-child { border-bottom: none; }
`

const RoleTag = styled.span<{ color: string }>`
  display: inline-block;
  background: ${(props) => props.color}22;
  border: 1px solid ${(props) => props.color}55;
  color: ${(props) => props.color};
  font-size: 13px;
  font-weight: bold;
  padding: 3px 10px;
  border-radius: 12px;
  margin-left: 10px;
`

const roleColors: Record<string, string> = {
  '血統分析': '#ff6b6b', '指数分析': '#38bdf8', '穴馬探し': '#fbbf24',
  '調教分析': '#a78bfa', '騎手分析': '#34d399', 'ペース分析': '#f472b6',
  '馬体重分析': '#fb923c', 'コース適性': '#22d3ee', '天候読み': '#818cf8',
  'クラス分析': '#e879f9', '枠順分析': '#facc15', 'データ収集': '#10b981',
  '戦略討論': '#f59e0b',
}

const deskLabels: Record<string, { label: string; color: string }> = {
  A: { label: 'デスクA 収集', color: '#10b981' },
  B: { label: 'デスクB 分析', color: '#38bdf8' },
  C: { label: 'デスクC 討論', color: '#f59e0b' },
}

export default function PredictionBoardDialog() {
  const dispatch = useAppDispatch()
  const open = useAppSelector((state) => state.predictionBoard.dialogOpen)
  const predictions = useAppSelector((state) => state.predictionBoard.predictions)
  const debates = useAppSelector((state) => state.predictionBoard.debates)
  const consensus = useAppSelector((state) => state.predictionBoard.consensus)
  const mission = useAppSelector((state) => state.predictionBoard.mission)
  const loading = useAppSelector((state) => state.predictionBoard.loading)

  const [missionInput, setMissionInput] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!open) return
    dispatch(setLoading(true))
    fetch('/api/predictions')
      .then((res) => res.json())
      .then((data) => {
        dispatch(setAgentState({
          predictions: data.predictions || [],
          debates: data.debates || [],
          consensus: data.consensus || '',
          mission: data.mission || '',
        }))
      })
      .catch((err) => console.error('Failed to fetch predictions:', err))
      .finally(() => dispatch(setLoading(false)))
  }, [open, dispatch])

  const handleSendMission = async () => {
    if (!missionInput.trim() || sending) return
    setSending(true)
    try {
      const res = await fetch('/api/mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission: missionInput.trim() }),
      })
      if (res.ok) {
        dispatch(setAgentState({
          predictions, debates, consensus,
          mission: missionInput.trim(),
        }))
        setMissionInput('')
      }
    } catch (err) {
      console.error('Failed to send mission:', err)
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => dispatch(closePredictionBoardDialog())}
      maxWidth={false}
      PaperProps={{
        style: { backgroundColor: 'transparent', boxShadow: 'none', width: '720px', maxWidth: '92vw' },
      }}
    >
      <NeonWrapper>
        <Header>
          <Box display="flex" alignItems="center">
            <EmojiEventsIcon style={{ color: '#fbbf24', marginRight: '12px', fontSize: '32px' }} />
            <Typography style={{ fontWeight: 'bold', letterSpacing: '2px', fontSize: '24px' }}>
              AUTOMATA PREDICTION BOARD
            </Typography>
          </Box>
          <IconButton onClick={() => dispatch(closePredictionBoardDialog())} style={{ color: '#e0f2fe' }}>
            <CloseIcon style={{ fontSize: '26px' }} />
          </IconButton>
        </Header>

        {loading ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress style={{ color: '#fbbf24' }} size={48} />
          </Box>
        ) : (
          <>
            {/* 課題入力 */}
            <MissionBox>
              <Box display="flex" alignItems="center" mb={1}>
                <SchoolIcon style={{ color: '#a78bfa', marginRight: '8px', fontSize: '22px' }} />
                <Typography style={{ fontWeight: 'bold', fontSize: '16px', color: '#a78bfa' }}>
                  課題を出す（ゼミの教授モード）
                </Typography>
              </Box>
              <Typography style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '10px' }}>
                ※ レースID(12桁)かnetkeibaのURLを含めてください。例: 「202605021211 を予測せよ」
              </Typography>
              <Box display="flex" gap={1}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="例: レースID 202605021211 を予測せよ"
                  value={missionInput}
                  onChange={(e) => setMissionInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSendMission() }}
                  InputProps={{
                    style: {
                      color: '#e0f2fe',
                      background: 'rgba(0, 0, 0, 0.3)',
                      borderRadius: '10px',
                      fontSize: '15px',
                    },
                  }}
                  sx={{
                    '& .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'rgba(100, 80, 255, 0.3)',
                    },
                    '&:hover .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'rgba(100, 80, 255, 0.5)',
                    },
                  }}
                />
                <Button
                  variant="contained"
                  onClick={handleSendMission}
                  disabled={!missionInput.trim() || sending}
                  startIcon={<SendIcon />}
                  style={{
                    background: 'linear-gradient(135deg, #7c3aed, #3b82f6)',
                    borderRadius: '10px',
                    textTransform: 'none',
                    fontWeight: 'bold',
                    minWidth: '100px',
                    fontSize: '14px',
                  }}
                >
                  送信
                </Button>
              </Box>
            </MissionBox>

            {/* 現在の課題 */}
            {mission && (
              <ActiveMissionBanner>
                <SchoolIcon style={{ color: '#c084fc', fontSize: '20px' }} />
                <Typography style={{ fontSize: '16px', fontWeight: 'bold', color: '#c084fc' }}>
                  現在の課題:
                </Typography>
                <Typography style={{ fontSize: '16px', color: '#e0f2fe' }}>
                  {mission}
                </Typography>
              </ActiveMissionBanner>
            )}

            {consensus && (
              <ConsensusBanner>
                <Typography style={{ fontSize: '16px', fontWeight: 'bold', color: '#fbbf24' }}>
                  {consensus}
                </Typography>
              </ConsensusBanner>
            )}

            {predictions.length === 0 ? (
              <Box textAlign="center" py={4}>
                <Typography style={{ color: '#94a3b8', fontSize: '16px' }}>
                  AIエージェント未起動 — npm run bots で起動してください
                </Typography>
              </Box>
            ) : (
              predictions.map((p, i) => {
                const desk = p.desk ? deskLabels[p.desk] : null
                return (
                  <BotCard key={i}>
                    <Box display="flex" alignItems="center" mb={1} flexWrap="wrap">
                      {desk && (
                        <RoleTag color={desk.color} style={{ marginLeft: 0, marginRight: '8px' }}>
                          {desk.label}
                        </RoleTag>
                      )}
                      <Typography style={{ fontWeight: 'bold', fontSize: '20px', color: '#fbbf24' }}>
                        {p.name}
                      </Typography>
                      <RoleTag color={roleColors[p.role] || '#94a3b8'}>{p.role}</RoleTag>
                    </Box>
                    <Typography style={{ fontSize: '18px', lineHeight: 1.7, color: p.prediction === '分析中...' ? '#64748b' : '#e0f2fe' }}>
                      {p.prediction}
                    </Typography>
                  </BotCard>
                )
              })
            )}

            {debates.length > 0 && (
              <>
                <Box display="flex" alignItems="center" mt={3} mb={2}>
                  <ForumIcon style={{ color: '#38bdf8', marginRight: '8px', fontSize: '22px' }} />
                  <Typography style={{ fontWeight: 'bold', fontSize: '18px', color: '#38bdf8', letterSpacing: '1px' }}>
                    RECENT DEBATES
                  </Typography>
                </Box>
                {debates.map((d, i) => (
                  <DebateCard key={i}>
                    <Typography style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>
                      {d.agentA} vs {d.agentB} — {d.topic}
                    </Typography>
                    {d.exchanges.map((e, j) => (
                      <DebateExchange key={j}>
                        <Typography style={{ fontSize: '15px', color: '#e0f2fe' }}>
                          <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>{e.speaker}:</span> {e.message}
                        </Typography>
                      </DebateExchange>
                    ))}
                  </DebateCard>
                ))}
              </>
            )}

            <Box mt={2} textAlign="center">
              <Typography style={{ color: '#475569', fontSize: '12px' }}>
                Powered by AUTOMATA + Gemini Flash + keiba_analysis
              </Typography>
            </Box>
          </>
        )}
      </NeonWrapper>
    </Dialog>
  )
}
