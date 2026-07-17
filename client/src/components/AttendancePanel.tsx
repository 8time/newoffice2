import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import AccountCircleIcon from '@mui/icons-material/AccountCircle'
import MailOutlineIcon from '@mui/icons-material/MailOutline'
import { resolveServerUrl } from '../services/serverUrl'
import { useAppDispatch } from '../hooks'
import { openDm, setDmName } from '../stores/DMStore'
import { getClientId } from '../util/clientId'

interface AttendanceRecord {
  name: string
  sessionId: string
  userKey?: string
  date: string
  checkIn: string
  checkOut: string | null
}

const Container = styled.div`
  padding: 16px 20px;
  border-bottom: 1px solid #2d2d2d;
`

const Title = styled.h3`
  margin: 0 0 14px 0;
  font-size: 20px;
  font-weight: 700;
  color: #c0c0c0;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
`

const BtnRow = styled.div`
  display: flex;
  gap: 6px;
`

const RefreshBtn = styled.button`
  background: none;
  border: 1px solid #555;
  color: #ccc;
  border-radius: 5px;
  cursor: pointer;
  font-size: 16px;
  padding: 4px 14px;
  text-transform: none;
  letter-spacing: 0;

  &:hover {
    background: #333;
    color: #fff;
  }
`

const RecordList = styled.ul<{ $scroll: boolean }>`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* 既定は最新4件だけなので高さを取らない。
     「すべて表示」にしたときだけ、伸びすぎないよう制限してスクロールさせる */
  ${(p) => (p.$scroll ? 'max-height: 220px; overflow-y: auto;' : '')}
`

const RecordItem = styled.li`
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 20px;
  color: #ccc;

  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #eee;
    font-weight: 600;
  }

  .time {
    color: #aaa;
    white-space: nowrap;
    font-size: 17px;
  }

  .person-icon {
    font-size: 28px !important;
    flex-shrink: 0;
  }

  /* 置手紙（DM）ボタン。普段は控えめで、行にホバーしたとき目立たせる */
  .dm-btn {
    flex-shrink: 0;
    background: none;
    border: none;
    color: #7f9bd8;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    border-radius: 6px;
    opacity: 0.35;
    transition: opacity 0.12s, background 0.12s;
  }
  &:hover .dm-btn { opacity: 1; }
  .dm-btn:hover { background: rgba(127, 155, 216, 0.2); }
`

const Empty = styled.p`
  color: #666;
  font-size: 20px;
  margin: 0;
`

const fmt = (iso: string) => {
  const d = new Date(iso)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

const AVATAR_COLORS = [
  '#44cc77', '#3498db', '#9b59b6', '#e67e22', '#e74c3c', '#1abc9c', '#f1c40f', '#e84393', '#00cec9', '#fdcb6e'
]

function getColorForName(name: string) {
  let sum = 0
  for (let i = 0; i < name.length; i++) {
    sum += name.charCodeAt(i)
  }
  return AVATAR_COLORS[sum % AVATAR_COLORS.length]
}

// 既定で見せる件数。全部出すとチャットの表示領域を圧迫するため、最新の数件だけにする
const DEFAULT_VISIBLE = 4

export default function AttendancePanel() {
  const dispatch = useAppDispatch()
  const myKey = getClientId()
  const [records, setRecords] = useState<AttendanceRecord[]>([])

  // 出社記録から置手紙（DM）を開く。相手が今いなくても送れる。
  // 宛先はブラウザ固定のuserKey。古い記録でuserKeyが無い場合はDMを開けない
  const openLetter = (r: AttendanceRecord) => {
    if (!r.userKey) return
    dispatch(setDmName({ userKey: r.userKey, name: r.name }))
    dispatch(openDm(r.userKey))
  }
  const [showAll, setShowAll] = useState(false)

  const load = async () => {
    try {
      // 以前は :2567 を決め打ちしていたため、本番では
      // https://<配信元>:2567/api/attendance へ繋ごうとして必ずタイムアウトしていた。
      // 解決規則はWebSocket接続先と共通のresolveServerUrlに任せる。
      const res = await fetch(resolveServerUrl('/api/attendance'))
      if (res.ok) setRecords(await res.json())
    } catch (e) {
      console.warn('[Attendance] 取得失敗:', e)
    }
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 60000)
    return () => clearInterval(id)
  }, [])

  // 新しいものから見たいので、出社時刻の新しい順に並べる
  const sorted = [...records].sort(
    (a, b) => new Date(b.checkIn).getTime() - new Date(a.checkIn).getTime()
  )
  const visible = showAll ? sorted : sorted.slice(0, DEFAULT_VISIBLE)
  const hiddenCount = sorted.length - visible.length

  return (
    <Container>
      <Title>
        今日の出社記録
        <BtnRow>
          <RefreshBtn onClick={load}>更新</RefreshBtn>
          {(showAll || hiddenCount > 0) && (
            <RefreshBtn onClick={() => setShowAll((v) => !v)}>
              {showAll ? '最新のみ' : `すべて表示${hiddenCount > 0 ? ` (${sorted.length})` : ''}`}
            </RefreshBtn>
          )}
        </BtnRow>
      </Title>

      {sorted.length === 0 ? (
        <Empty>記録がありません</Empty>
      ) : (
        <RecordList $scroll={showAll}>
          {visible.map((r, i) => (
            <RecordItem key={i}>
              <AccountCircleIcon 
                className="person-icon" 
                style={{ color: r.checkOut ? '#777' : getColorForName(r.name) }} 
              />
              <span className="name">{r.name}</span>
              <span className="time">
                {fmt(r.checkIn)}
                {r.checkOut ? ` → ${fmt(r.checkOut)}` : ' 〜 在席'}
              </span>
              {r.userKey && r.userKey !== myKey && (
                <button className="dm-btn" title={`${r.name}に置手紙を送る`} onClick={() => openLetter(r)}>
                  <MailOutlineIcon style={{ fontSize: 22 }} />
                </button>
              )}
            </RecordItem>
          ))}
        </RecordList>
      )}
    </Container>
  )
}
