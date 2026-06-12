import React, { useEffect, useState } from 'react'
import styled, { keyframes } from 'styled-components'
import { phaserEvents, Event } from '../events/EventCenter'
import { playKnockSound } from '../util/sound'

interface KnockInfo {
  fromName: string
  fromSessionId: string
  id: number
}

const slideIn = keyframes`
  from { transform: translateX(120%); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
`

const Container = styled.div`
  position: fixed;
  top: 80px;
  right: 24px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
`

const Toast = styled.div`
  background: rgba(20, 20, 35, 0.95);
  border: 1px solid rgba(255, 200, 0, 0.5);
  border-radius: 14px;
  padding: 14px 18px;
  min-width: 260px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.5);
  animation: ${slideIn} 0.3s ease;
  pointer-events: auto;
  backdrop-filter: blur(10px);
`

const Title = styled.div`
  font-size: 15px;
  font-weight: bold;
  color: #fbbf24;
  margin-bottom: 4px;
`

const Body = styled.div`
  font-size: 13px;
  color: #e0f2fe;
  margin-bottom: 10px;
`

const Actions = styled.div`
  display: flex;
  gap: 8px;
  justify-content: flex-end;
`

const Btn = styled.button<{ primary?: boolean }>`
  padding: 5px 14px;
  border-radius: 8px;
  border: 1px solid ${({ primary }) => (primary ? 'rgba(251,191,36,0.6)' : 'rgba(255,255,255,0.2)')};
  background: ${({ primary }) => (primary ? 'rgba(251,191,36,0.15)' : 'transparent')};
  color: ${({ primary }) => (primary ? '#fbbf24' : '#94a3b8')};
  font-size: 12px;
  cursor: pointer;
  transition: opacity 0.15s;

  &:hover { opacity: 0.75; }
`

function showBrowserNotification(name: string) {
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    new Notification(`🔔 ${name}が呼んでいます`, {
      body: '仮想オフィスで呼ばれています',
      icon: '/favicon.ico',
    })
  }
}

export default function KnockNotification() {
  const [knocks, setKnocks] = useState<KnockInfo[]>([])

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }

    const handler = (fromSessionId: string, fromName: string) => {
      playKnockSound()
      showBrowserNotification(fromName)
      const id = Date.now()
      setKnocks((prev) => [...prev, { fromName, fromSessionId, id }])
      setTimeout(() => setKnocks((prev) => prev.filter((k) => k.id !== id)), 8000)
    }

    phaserEvents.on(Event.KNOCK_RECEIVED, handler)
    return () => { phaserEvents.off(Event.KNOCK_RECEIVED, handler) }
  }, [])

  const dismiss = (id: number) => setKnocks((prev) => prev.filter((k) => k.id !== id))

  return (
    <Container>
      {knocks.map((k) => (
        <Toast key={k.id}>
          <Title>🔔 呼ばれています</Title>
          <Body>{k.fromName} さんが呼んでいます</Body>
          <Actions>
            <Btn onClick={() => dismiss(k.id)}>閉じる</Btn>
            <Btn primary onClick={() => dismiss(k.id)}>了解！</Btn>
          </Actions>
        </Toast>
      ))}
    </Container>
  )
}
