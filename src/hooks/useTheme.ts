import { useEffect, useSyncExternalStore } from 'react'
import { useUi } from '@/store/ui'

const query = '(prefers-color-scheme: dark)'

function subscribe(cb: () => void) {
  const mq = window.matchMedia(query)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

/** Resolved theme ("light" | "dark"), applied to <html data-theme>. */
export function useResolvedTheme(): 'light' | 'dark' {
  const pref = useUi((s) => s.theme)
  const systemDark = useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref
}

export function useApplyTheme() {
  const theme = useResolvedTheme()
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    root.style.colorScheme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#121615' : '#F3F4F1')
  }, [theme])
  return theme
}
