import { useLayoutEffect } from 'react'
import Phaser from 'phaser'
import phaserGame from '../PhaserGame'

/** スマホオフィスタブ: RESIZE のままコンテナ追従（FIT は使わない） */
export function usePhonePhaserScale(active: boolean) {
  useLayoutEffect(() => {
    if (!active) return

    const apply = () => {
      if (!phaserGame.isRunning) return
      phaserGame.scale.setMode(Phaser.Scale.RESIZE)
      phaserGame.scale.refresh()
    }

    apply()
    const t = window.setTimeout(apply, 150)
    window.addEventListener('resize', apply)
    window.addEventListener('orientationchange', apply)

    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', apply)
      window.removeEventListener('orientationchange', apply)
    }
  }, [active])
}
