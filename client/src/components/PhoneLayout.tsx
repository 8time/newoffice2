import React, { useEffect, useState } from 'react'
import phaserGame from '../PhaserGame'
import PhoneHeader from './PhoneHeader'
import PhoneActionBar from './PhoneActionBar'
import OnlineUsers from './OnlineUsers'
import AttendancePanel from './AttendancePanel'
import Chat from './Chat'
import { setPhoneTabAttribute } from '../hooks/usePhoneBodyClass'
import { useVisualViewportKeyboard } from '../hooks/useVisualViewportKeyboard'
import { useAppDispatch } from '../hooks'
import { setFocused, setShowChat } from '../stores/ChatStore'

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

  useEffect(() => {
    setPhoneTabAttribute(tab)
    if (tab === 'office') {
      // タブ復帰時に Phaser の描画領域をコンテナサイズへ合わせ直す
      requestAnimationFrame(() => phaserGame.scale.refresh())
    }
    return () => setPhoneTabAttribute(null)
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
