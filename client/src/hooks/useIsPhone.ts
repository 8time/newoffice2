import { useEffect, useState } from 'react'
import { isPhone } from '../utils/deviceDetect'

const PHONE_MQ = '(pointer: coarse) and (max-width: 767px)'

/** CSSと同一の matchMedia 条件。resize / orientationchange で再評価する */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => isPhone())

  useEffect(() => {
    const mq = window.matchMedia(PHONE_MQ)
    const update = () => setPhone(mq.matches)
    update()
    mq.addEventListener('change', update)
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      mq.removeEventListener('change', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  return phone
}
