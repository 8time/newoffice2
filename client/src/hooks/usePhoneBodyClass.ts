import { useEffect } from 'react'

/** body に is-phone を付与（phone.css のスコープ用） */
export function usePhoneBodyClass(isPhone: boolean) {
  useEffect(() => {
    if (isPhone) {
      document.body.classList.add('is-phone')
    } else {
      document.body.classList.remove('is-phone')
      document.body.removeAttribute('data-phone-tab')
    }
    return () => {
      document.body.classList.remove('is-phone')
      document.body.removeAttribute('data-phone-tab')
    }
  }, [isPhone])
}

export function setPhoneTabAttribute(tab: string | null) {
  if (!document.body.classList.contains('is-phone')) return
  if (tab) {
    document.body.setAttribute('data-phone-tab', tab)
  } else {
    document.body.removeAttribute('data-phone-tab')
  }
}
