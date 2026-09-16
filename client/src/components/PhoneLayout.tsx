import React, { useEffect, useLayoutEffect, useState } from 'react'
import PhoneHeader from './PhoneHeader'
import { usePhonePhaserScale } from '../hooks/usePhonePhaserScale'
import PhoneActionBar from './PhoneActionBar'
import OnlineUsers from './OnlineUsers'
import AttendancePanel from './AttendancePanel'
import Chat from './Chat'
import { syncPhoneTabAttribute } from '../hooks/usePhoneBodyClass'
import { useVisualViewportKeyboard } from '../hooks/useVisualViewportKeyboard'
import { useAppDispatch } from '../hooks'
import { setFocused, setShowChat } from '../stores/ChatStore'
import phaserGame from '../PhaserGame'

export type PhoneTab = 'office' | 'members' | 'chat' | 'attendance'

const TABS: { id: PhoneTab; label: string }[] = [
  { id: 'office', label: 'オフィス' },
  { id: 'members', label: 'メンバー' },
  { id: 'chat', label: 'チャット' },
  { id: 'attendance', label: '出社記録' },
]

export default function PhoneLayout() {
  const [tab, setTab] = useState<PhoneTab>('office')
  const dispatch = useAppDispatch()

  useVisualViewportKeyboard(tab === 'chat')
  usePhonePhaserScale(tab === 'office')

  useLayoutEffect(() => {
    syncPhoneTabAttribute(tab)
  }, [tab])

  useLayoutEffect(() => () => syncPhoneTabAttribute(null), [])

  useLayoutEffect(() => {
    if (tab !== 'office') return
    requestAnimationFrame(() => {
      if (phaserGame.isRunning) phaserGame.scale.refresh()
    })
  }, [tab])

  useEffect(() => {
    if (tab === 'chat') {
      dispatch(setShowChat(true))
      dispatch(setFocused(false))
    }
  }, [tab, dispatch])

  return (
    <div className="phone-shell" aria-label="スマホレイアウト">
      <PhoneHeader />
      <nav className="phone-tab-bar" aria-label="メインタブ">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`phone-tab-btn${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'office' ? (
        <div className="phone-map-spacer" aria-hidden="true" />
      ) : (
        <main className="phone-main">
          {tab === 'members' && (
            <div className="phone-main-scroll">
              <OnlineUsers />
            </div>
          )}
          {tab === 'attendance' && (
            <div className="phone-main-scroll">
              <AttendancePanel />
            </div>
          )}
          {tab === 'chat' && (
            <div className="phone-chat-host">
              <Chat />
            </div>
          )}
        </main>
      )}

      {tab === 'office' && <PhoneActionBar />}
    </div>
  )
}
