import { useLayoutEffect } from 'react'

/** body に is-phone を付与（phone.css のスコープ用） */
export function syncPhoneBodyClass(isPhone: boolean) {
  if (typeof document === 'undefined') return
  if (isPhone) {
    document.body.classList.add('is-phone')
  } else {
    document.body.classList.remove('is-phone')
    document.body.removeAttribute('data-phone-tab')
  }
}

export function syncLoggedInBodyClass(loggedIn: boolean) {
  if (typeof document === 'undefined') return
  if (loggedIn) {
    document.body.classList.add('logged-in')
  } else {
    document.body.classList.remove('logged-in')
    document.body.removeAttribute('data-phone-tab')
  }
}

export function usePhoneBodyClass(isPhone: boolean) {
  useLayoutEffect(() => {
    syncPhoneBodyClass(isPhone)
    return () => {
      if (!isPhone) {
        document.body.classList.remove('is-phone')
        document.body.removeAttribute('data-phone-tab')
      }
    }
  }, [isPhone])
}

export function useLoggedInBodyClass(loggedIn: boolean) {
  useLayoutEffect(() => {
    syncLoggedInBodyClass(loggedIn)
    return () => {
      if (!loggedIn) {
        document.body.classList.remove('logged-in')
        document.body.removeAttribute('data-phone-tab')
      }
    }
  }, [loggedIn])
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
