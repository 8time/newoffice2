import { useEffect } from 'react'
import Phaser from 'phaser'
import phaserGame from '../PhaserGame'

/** スマホオフィスタブ: 縦長画面での潰れを防ぐため FIT、それ以外は RESIZE に戻す */
export function usePhonePhaserScale(active: boolean) {
  useEffect(() => {
    if (!active) return

    const apply = () => {
      if (!phaserGame.isRunning) return
      phaserGame.scale.setMode(Phaser.Scale.FIT)
      phaserGame.scale.refresh()
    }

    apply()
    const t = window.setTimeout(apply, 200)
    window.addEventListener('resize', apply)
    window.addEventListener('orientationchange', apply)

    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', apply)
      window.removeEventListener('orientationchange', apply)
      if (phaserGame.isRunning) {
        phaserGame.scale.setMode(Phaser.Scale.RESIZE)
        phaserGame.scale.refresh()
      }
    }
  }, [active])
}
