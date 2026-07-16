import React, { useEffect, useState } from 'react'
import styled, { keyframes } from 'styled-components'
import { phaserEvents, Event } from '../events/EventCenter'
import { playDmSound } from '../util/sound'
import { useAppDispatch } from '../hooks'
import { openDm, setDmName } from '../stores/DMStore'

interface DmToast {
  id: number
  fromUserKey: string
  fromName: string
  content: string
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
  background: rgba(20, 24, 45, 0.97);
  border: 1px solid rgba(120, 150, 240, 0.6);
  border-radius: 14px;
  padding: 14px 16px;
  width: 300px;
  box-shadow: 0 6px 28px rgba(0,0,0,0.55);
  animation: ${slideIn} 0.3s ease;
  pointer-events: auto;
  backdrop-filter: blur(10px);
  cursor: pointer;
  display: flex;
  gap: 12px;
  align-items: flex-start;

  &:hover { border-color: rgba(150, 180, 255, 0.9); }
`

const Icon = styled.div`
  font-size: 30px;
  line-height: 1;
  flex-shrink: 0;
`

const TextArea = styled.div`
  flex: 1;
  min-width: 0;

  .title { font-size: 15px; font-weight: 700; color: #9db4ff; margin-bottom: 3px; }
  .body {
    font-size: 14px;
    color: #e6ebff;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .hint { font-size: 11px; color: #8890b0; margin-top: 4px; }
`

const Close = styled.button`
  background: none;
  border: none;
  color: #8890b0;
  font-size: 18px;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0 2px;
  &:hover { color: #fff; }
`

function showBrowserNotification(name: string, content: string) {
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    new Notification(`💬 ${name} さんからDM`, { body: content.slice(0, 80), icon: '/favicon.ico' })
  }
}

export default function DMNotification() {
  const dispatch = useAppDispatch()
  const [toasts, setToasts] = useState<DmToast[]>([])

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
    const handler = (fromUserKey: string, fromName: string, content: string) => {
      playDmSound()
      showBrowserNotification(fromName, content)
      const id = Date.now() + Math.random()
      // 同じ相手の古いトーストは置き換える
      setToasts((prev) => [...prev.filter((t) => t.fromUserKey !== fromUserKey), { id, fromUserKey, fromName, content }])
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 7000)
    }
    phaserEvents.on(Event.DM_RECEIVED, handler)
    return () => { phaserEvents.off(Event.DM_RECEIVED, handler) }
  }, [])

  const dismiss = (id: number, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  const open = (t: DmToast) => {
    dispatch(setDmName({ userKey: t.fromUserKey, name: t.fromName }))
    dispatch(openDm(t.fromUserKey))
    setToasts((prev) => prev.filter((x) => x.id !== t.id))
  }

  return (
    <Container>
      {toasts.map((t) => (
        <Toast key={t.id} onClick={() => open(t)}>
          <Icon>💬</Icon>
          <TextArea>
            <div className="title">{t.fromName} さんからDM</div>
            <div className="body">{t.content}</div>
            <div className="hint">クリックで開く</div>
          </TextArea>
          <Close onClick={(e) => dismiss(t.id, e)}>×</Close>
        </Toast>
      ))}
    </Container>
  )
}
