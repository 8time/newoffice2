import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import AccountCircleIcon from '@mui/icons-material/AccountCircle'

interface AttendanceRecord {
  name: string
  sessionId: string
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

const RecordList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 220px;
  overflow-y: auto;
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

export default function AttendancePanel() {
  const [records, setRecords] = useState<AttendanceRecord[]>([])

  const load = async () => {
    try {
      const protocol = window.location.protocol
      const host = window.location.hostname
      const url = `${protocol}//${host}:2567/api/attendance`
      const res = await fetch(url)
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

  return (
    <Container>
      <Title>
        今日の出社記録
        <RefreshBtn onClick={load}>更新</RefreshBtn>
      </Title>

      {records.length === 0 ? (
        <Empty>記録がありません</Empty>
      ) : (
        <RecordList>
          {records.map((r, i) => (
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
            </RecordItem>
          ))}
        </RecordList>
      )}
    </Container>
  )
}
