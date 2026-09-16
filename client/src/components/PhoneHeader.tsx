import React, { useEffect, useState } from 'react'
import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'
import { useAppDispatch, useAppSelector } from '../hooks'
import { setMyStatus } from '../stores/UserStore'
import { phaserEvents, Event } from '../events/EventCenter'
import { playAwaySound, playPresentSound } from '../util/sound'
import { AwayDialog, AwayMessageDialog } from './StatusToggle'

type StatusType = 'present' | 'away'

function PhoneClock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const ampm = time.getHours() < 12 ? 'AM' : 'PM'
  const h = time.getHours() % 12 || 12
  const s = `${time.getMonth() + 1}/${time.getDate()} ${ampm}${String(h).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
  return <span className="phone-clock">{s}</span>
}

export default function PhoneHeader() {
  const dispatch = useAppDispatch()
  const myStatus = useAppSelector((state) => state.user.myStatus)
  const myAwayMessage = useAppSelector((state) => state.user.myAwayMessage)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [awayMsgOpen, setAwayMsgOpen] = useState(false)
  const [awayTarget, setAwayTarget] = useState({ playerId: '', message: '' })

  useEffect(() => {
    const handler = (playerId: string, message: string) => {
      setAwayTarget({ playerId, message })
      setAwayMsgOpen(true)
    }
    phaserEvents.on(Event.SHOW_AWAY_MESSAGE, handler)
    return () => { phaserEvents.off(Event.SHOW_AWAY_MESSAGE, handler) }
  }, [])

  const applyStatus = (status: StatusType, message = '') => {
    const wasPresent = myStatus === 'present'
    dispatch(setMyStatus({ status, awayMessage: message }))
    const game = phaserGame.scene.keys.game as Game
    if (status === 'present') game?.myPlayer?.clearAwayStatus()
    else game?.myPlayer?.setAwayStatus(message || '🔴 離席中')
    game?.network?.updateStatus(status, message)
    if (status === 'present' && !wasPresent) playPresentSound()
    else if (status !== 'present' && wasPresent) playAwaySound()
  }

  return (
    <>
      <header className="phone-header">
        <span className="phone-title">SkyOffice</span>
        <PhoneClock />
        <div className="phone-status">
          <button
            type="button"
            className={`phone-status-btn${myStatus === 'present' ? ' active-present' : ''}`}
            onClick={() => myStatus !== 'present' && applyStatus('present')}
          >
            在席
          </button>
          <button
            type="button"
            className={`phone-status-btn${myStatus === 'away' ? ' active-away' : ''}`}
            onClick={() => myStatus !== 'away' && setDialogOpen(true)}
          >
            離席
          </button>
        </div>
      </header>
      <AwayDialog
        open={dialogOpen}
        initialMessage={myAwayMessage}
        onConfirm={(msg) => { setDialogOpen(false); applyStatus('away', msg) }}
        onCancel={() => setDialogOpen(false)}
      />
      <AwayMessageDialog
        open={awayMsgOpen}
        playerId={awayTarget.playerId}
        message={awayTarget.message}
        onClose={() => setAwayMsgOpen(false)}
      />
    </>
  )
}
