import { useEffect } from 'react'
import { toast } from 'sonner'

/**
 * Registers the service worker that makes the app work offline (production
 * builds only). When a new version has been deployed, offers to reload.
 */
export function useServiceWorker() {
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
    let cancelled = false
    void import('virtual:pwa-register').then(({ registerSW }) => {
      if (cancelled) return
      const updateSW = registerSW({
        onNeedRefresh() {
          toast('Update available', {
            description: 'A new version of Schemasketch is ready. Your work is saved in this browser.',
            duration: Infinity,
            action: { label: 'Reload', onClick: () => void updateSW(true) },
          })
        },
        onOfflineReady() {
          toast.success('Ready to work offline', { description: 'Schemasketch now opens without a connection.' })
        },
        onRegisteredSW(_url, registration) {
          // look for a new version every hour while the tab stays open
          if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000)
        },
      })
    })
    return () => {
      cancelled = true
    }
  }, [])
}
