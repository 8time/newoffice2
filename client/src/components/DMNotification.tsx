import React, { useEffect, useRef, useState } from 'react'
import styled, { keyframes } from 'styled-components'
import { playDmSound } from '../util/sound'
import { useAppDispatch, useAppSelector } from '../hooks'
import { openDm, setDmName } from '../stores/DMStore'
import { getClientId } from '../util/clientId'

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
  const messagesByKey = useAppSelector((s) => s.dm.messagesByKey)
  const lastReadByKey = useAppSelector((s) => s.dm.lastReadByKey)
  const openKey = useAppSelector((s) => s.dm.openKey)
  const myKey = getClientId()
  // 一度知らせたメッセージのidを覚えておき、再通知を防ぐ
  const shownIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  // 未読のDM（その場にいなかった相手からの置手紙も含む）を検出して知らせる。
  // 一時イベントではなくRedux状態から判定するので、入室時にまとめて届く受信箱でも
  // マウント競合で取りこぼさない。ライブのDMも同じ経路で通知される。
  useEffect(() => {
    for (const [otherKey, msgs] of Object.entries(messagesByKey)) {
      if (otherKey === openKey) continue // 開いている会話は通知しない
      const lastRead = lastReadByKey[otherKey] || 0
      const unread = msgs.filter(
        (m) => m.fromUserKey !== myKey && m.createdAt > lastRead && !shownIds.current.has(m.id)
      )
      if (unread.length === 0) continue
      unread.forEach((m) => shownIds.current.add(m.id))
      const latest = unread[unread.length - 1]
      playDmSound()
      showBrowserNotification(latest.fromName, latest.content)
      const id = Date.now() + Math.random()
      // 同じ相手の古いトーストは置き換える
      setToasts((prev) => [
        ...prev.filter((t) => t.fromUserKey !== otherKey),
        { id, fromUserKey: otherKey, fromName: latest.fromName, content: latest.content },
      ])
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 7000)
    }
  }, [messagesByKey, lastReadByKey, openKey, myKey])

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
