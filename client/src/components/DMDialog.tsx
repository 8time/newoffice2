import React, { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import IconButton from '@mui/material/IconButton'
import CloseIcon from '@mui/icons-material/Close'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'

import { useAppDispatch, useAppSelector } from '../hooks'
import { closeDm } from '../stores/DMStore'
import { getClientId } from '../util/clientId'
import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'

const Backdrop = styled.div`
  position: fixed;
  /* 60pxだとMAP下部の操作バー（画面共有〜設定、高さ約200px）や、
     左下の保存容量メーター（狭い画面ではbottom:230〜326pxの範囲）と
     重なっていた。両方より確実に上になる340pxまで上げる。 */
  bottom: 340px;
  left: 0;
  height: 460px;
  width: 500px;
  max-height: 60%;
  max-width: 100%;
  z-index: 900;
`

const Wrapper = styled.div`
  position: relative;
  height: 100%;
  padding: 16px;
  display: flex;
  flex-direction: column;
`

const Header = styled.div`
  position: relative;
  height: 48px;
  background: #4a5fb0;
  border-radius: 10px 10px 0 0;
  display: flex;
  align-items: center;
  padding: 0 8px;
  gap: 6px;

  h3 { color: #fff; margin: 0; font-size: 18px; font-weight: 700; flex: 1; text-align: center; }
  .btn { color: #fff; }
`

const Box = styled.div`
  flex: 1;
  overflow-y: auto;
  background: #1a1a2e;
  border: 2px solid #00000029;
  padding: 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;

  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-thumb { background: #444; border-radius: 2px; }
`

const BubbleRow = styled.div<{ isMine: boolean }>`
  display: flex;
  flex-direction: ${({ isMine }) => (isMine ? 'row-reverse' : 'row')};
`

const Bubble = styled.div<{ isMine: boolean }>`
  background: ${({ isMine }) => (isMine ? '#85e249' : '#ffffff')};
  color: #111;
  border-radius: 14px;
  padding: 8px 12px;
  font-size: 16px;
  line-height: 1.4;
  word-break: break-word;
  max-width: 78%;
  box-shadow: 0 1px 2px rgba(0,0,0,0.15);
`

const TimeLabel = styled.span`
  font-size: 11px;
  color: #888;
  align-self: flex-end;
  margin: 0 6px;
`

const DateDivider = styled.div`
  display: flex;
  justify-content: center;
  margin: 6px 0 2px;
  span { background: rgba(255,255,255,0.12); color: #cfd3e0; font-size: 12px; padding: 3px 14px; border-radius: 12px; }
`

const InputBar = styled.form`
  display: flex;
  border: 1px solid #4a5fb0;
  border-radius: 0 0 10px 10px;
  background: linear-gradient(180deg, #000000c1, #242424c0);

  input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    color: #e0e0e0;
    font-size: 16px;
    padding: 12px;
  }
  button {
    border: none;
    background: #4a5fb0;
    color: #fff;
    padding: 0 18px;
    cursor: pointer;
    font-size: 15px;
    font-weight: 700;
    &:disabled { opacity: 0.4; cursor: not-allowed; }
  }
`

const timeFmt = new Intl.DateTimeFormat('ja', { timeStyle: 'short' })
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
function dateLabel(ts: number) {
  const d = new Date(ts), t = new Date(), y = new Date()
  y.setDate(t.getDate() - 1)
  const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (same(d, t)) return '今日'
  if (same(d, y)) return '昨日'
  return `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAYS[d.getDay()]})`
}
function diffDay(a: number, b: number) {
  const da = new Date(a), db = new Date(b)
  return da.getFullYear() !== db.getFullYear() || da.getMonth() !== db.getMonth() || da.getDate() !== db.getDate()
}

export default function DMDialog() {
  const dispatch = useAppDispatch()
  const openKey = useAppSelector((state) => state.dm.openKey)
  const messagesByKey = useAppSelector((state) => state.dm.messagesByKey)
  const namesByKey = useAppSelector((state) => state.dm.namesByKey)
  const [input, setInput] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const myKey = getClientId()

  const messages = openKey ? messagesByKey[openKey] || [] : []
  const otherName = openKey ? namesByKey[openKey] || '相手' : ''

  // 開いたときに履歴を要求
  useEffect(() => {
    if (!openKey) return
    const game = phaserGame.scene.keys.game as Game
    game?.network?.requestDmHistory(openKey)
  }, [openKey])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, openKey])

  if (!openKey) return null

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault()
    const val = input.trim()
    if (!val) return
    const game = phaserGame.scene.keys.game as Game
    game?.network?.sendDm(openKey, val)
    setInput('')
  }

  return (
    <Backdrop>
      <Wrapper>
        <Header>
          <IconButton className="btn" size="small" onClick={() => dispatch(closeDm())}>
            <ArrowBackIcon />
          </IconButton>
          <h3>{otherName}</h3>
          <IconButton className="btn" size="small" onClick={() => dispatch(closeDm())}>
            <CloseIcon />
          </IconButton>
        </Header>

        <Box>
          {messages.map((m, i) => {
            const isMine = m.fromUserKey === myKey
            const prev = messages[i - 1]
            const showDate = i === 0 || !prev || diffDay(prev.createdAt, m.createdAt)
            return (
              <React.Fragment key={m.id}>
                {showDate && <DateDivider><span>{dateLabel(m.createdAt)}</span></DateDivider>}
                <BubbleRow isMine={isMine}>
                  <Bubble isMine={isMine}>{m.content}</Bubble>
                  <TimeLabel>{timeFmt.format(m.createdAt)}</TimeLabel>
                </BubbleRow>
              </React.Fragment>
            )
          })}
          <div ref={endRef} />
        </Box>

        <InputBar onSubmit={handleSend}>
          <input
            autoFocus
            placeholder={`${otherName}へメッセージ`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" disabled={!input.trim()}>送信</button>
        </InputBar>
      </Wrapper>
    </Backdrop>
  )
}
