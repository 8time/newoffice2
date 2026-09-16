import { useLayoutEffect } from 'react'
import Phaser from 'phaser'
import phaserGame from '../PhaserGame'

/**
 * スマホオフィスタブ: 縦横比を保った FIT 表示（潰れ防止）。
 * canvas の CSS 上書きは行わない（白画面の原因になっていたため）。
 */
export function usePhonePhaserScale(active: boolean) {
  useLayoutEffect(() => {
    if (!active) return

    const apply = () => {
      if (!phaserGame.isRunning) return
      phaserGame.scale.setMode(Phaser.Scale.FIT)
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
      if (phaserGame.isRunning) {
        phaserGame.scale.setMode(Phaser.Scale.RESIZE)
        phaserGame.scale.refresh()
      }
    }
  }, [active])
}
