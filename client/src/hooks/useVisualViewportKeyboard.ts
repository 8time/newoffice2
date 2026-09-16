import { useEffect } from 'react'

/**
 * iOS Safari 等でキーボード表示時に visualViewport の変化を
 * --phone-keyboard-offset に反映し、入力欄位置を補正する。
 */
export function useVisualViewportKeyboard(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const vv = window.visualViewport
    if (!vv) return

    const update = () => {
      const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      document.body.style.setProperty('--phone-keyboard-offset', `${offset}px`)
    }

    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      document.body.style.removeProperty('--phone-keyboard-offset')
    }
  }, [enabled])
}
