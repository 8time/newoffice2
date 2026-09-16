import { useLayoutEffect } from 'react'

/** body に is-phone を付与（phone.css のスコープ用）。初回描画前に必ず反映する */
export function syncPhoneBodyClass(isPhone: boolean) {
  if (typeof document === 'undefined') return
  if (isPhone) {
    document.body.classList.add('is-phone')
  } else {
    document.body.classList.remove('is-phone')
    document.body.removeAttribute('data-phone-tab')
  }
}

export function usePhoneBodyClass(isPhone: boolean) {
  // render 中にも反映（useEffect だと初回 paint より遅れて MAP が全画面になる）
  syncPhoneBodyClass(isPhone)

  useLayoutEffect(() => {
    syncPhoneBodyClass(isPhone)
    return () => {
      document.body.classList.remove('is-phone')
      document.body.removeAttribute('data-phone-tab')
    }
  }, [isPhone])
}

export function syncPhoneTabAttribute(tab: string | null) {
  if (typeof document === 'undefined') return
  if (tab) {
    document.body.setAttribute('data-phone-tab', tab)
  } else {
    document.body.removeAttribute('data-phone-tab')
  }
}

/** @deprecated syncPhoneTabAttribute を使用 */
export function setPhoneTabAttribute(tab: string | null) {
  syncPhoneTabAttribute(tab)
}
