import React from 'react'
import styled from 'styled-components'
import { useAppSelector } from '../hooks'
import { getColorByString } from '../util'
import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'

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
`

const UserList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const UserItem = styled.li<{ statusColor: string }>`
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 22px;
  color: #e0e0e0;

  .dot {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: ${({ statusColor }) => statusColor};
    flex-shrink: 0;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .badge {
    font-size: 16px;
    padding: 3px 10px;
    border-radius: 5px;
    background: #ff6b35;
    color: #fff;
    flex-shrink: 0;
    font-weight: 700;
  }
`

const Empty = styled.p`
  color: #666;
  font-size: 20px;
  margin: 0;
`

const KnockBtn = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  font-size: 20px;
  padding: 2px 6px;
  border-radius: 6px;
  opacity: 0.5;
  transition: opacity 0.15s, transform 0.15s;
  flex-shrink: 0;

  &:hover {
    opacity: 1;
    transform: scale(1.2);
  }
`

const STATUS_DOT: Record<string, string> = {
  present: '#44cc77',
  away:    '#ff6b35',
  focus:   '#f59e0b',
  break:   '#60a5fa',
}

export default function OnlineUsers() {
  const playerNameMap = useAppSelector((state) => state.user.playerNameMap)
  const playerStatusMap = useAppSelector((state) => state.user.playerStatusMap)
  const mySessionId = useAppSelector((state) => state.user.sessionId)
  const myName = useAppSelector((state) => {
    const sessionId = state.user.sessionId
    return state.user.playerNameMap.get(sessionId.replace(/[^0-9a-z]/gi, 'G')) || null
  })
  const myStatus = useAppSelector((state) => state.user.myStatus)

  const otherUsers = Array.from(playerNameMap.entries())

  const handleKnock = (targetId: string, name: string) => {
    const game = phaserGame.scene.keys.game as Game
    game?.network?.knockPlayer(targetId)
  }

  return (
    <Container>
      <Title>在席メンバー ({otherUsers.length + (myName ? 1 : 0)}人)</Title>
      <UserList>
        {myName && (
          <UserItem statusColor={STATUS_DOT[myStatus] || '#44cc77'}>
            <span className="dot" />
            <span className="name" style={{ color: getColorByString(myName) }}>
              {myName}（自分）
            </span>
            {myStatus !== 'present' && (
              <span className="badge" style={{
                background: STATUS_DOT[myStatus] || '#ff6b35'
              }}>
                {myStatus === 'away' ? '離席' : myStatus === 'focus' ? '集中' : '休憩'}
              </span>
            )}
          </UserItem>
        )}

        {otherUsers.map(([id, name]) => {
          const statusInfo = playerStatusMap.get(id)
          const status = statusInfo?.status || 'present'
          return (
            <UserItem key={id} statusColor={STATUS_DOT[status] || '#44cc77'}>
              <span className="dot" />
              <span className="name" style={{ color: getColorByString(name) }}>
                {name}
              </span>
              {status !== 'present' && (
                <span className="badge" style={{ background: STATUS_DOT[status] || '#ff6b35' }}>
                  {status === 'away' ? '離席' : status === 'focus' ? '集中' : '休憩'}
                </span>
              )}
              <KnockBtn onClick={() => handleKnock(id, name)} title={`${name}を呼ぶ`}>
                🔔
              </KnockBtn>
            </UserItem>
          )
        })}

        {otherUsers.length === 0 && !myName && <Empty>まだ誰もいません</Empty>}
      </UserList>
    </Container>
  )
}
