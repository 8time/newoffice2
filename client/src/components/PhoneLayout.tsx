import React, { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
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
import { closeDm } from '../stores/DMStore'
import { setSignboardPlacing } from '../stores/SignboardStore'
import { useAppSelector } from '../hooks'
import { phaserEvents, Event } from '../events/EventCenter'
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
  const dmOpen = useAppSelector((state) => state.dm.openKey !== null)

  useVisualViewportKeyboard(tab === 'chat' || dmOpen)
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

  // スマホでタブが切り替わった時（メンバーからオフィスに戻った等）はDMを閉じる
  useEffect(() => {
    dispatch(closeDm())
  }, [tab, dispatch])

  // A placement preview belongs to the map.  Do not leave its Phaser pointer
  // handler active while the user moves to another phone tab.
  useEffect(() => {
    if (tab === 'office') return
    phaserEvents.emit(Event.SIGNBOARD_PLACE_CANCEL)
    dispatch(setSignboardPlacing(false))
  }, [tab, dispatch])

  /* body 直下に portal し canvas より必ず前面に出す（全画面オーバーレイは使わない） */
  return createPortal(
    <div className="phone-chrome" aria-label="スマホレイアウト">
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

      {tab !== 'office' && (
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
    </div>,
    document.body
  )
}
