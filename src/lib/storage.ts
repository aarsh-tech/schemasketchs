import type { PersistStorage, StorageValue } from 'zustand/middleware'

/**
 * localStorage wrapper that never throws (private mode, quota, disabled
 * storage) and batches writes, so typing in the editor doesn't serialise
 * every project on every keystroke.
 */
export function createDebouncedStorage<T>(delay = 400): PersistStorage<T> {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const queued = new Map<string, StorageValue<T>>()

  const write = (name: string) => {
    const value = queued.get(name)
    queued.delete(name)
    timers.delete(name)
    if (!value) return
    try {
      localStorage.setItem(name, JSON.stringify(value))
    } catch (err) {
      console.warn('[schemasketch] could not save to localStorage', err)
    }
  }

  if (typeof window !== 'undefined') {
    const flushAll = () => {
      for (const name of [...queued.keys()]) write(name)
    }
    window.addEventListener('pagehide', flushAll)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushAll()
    })
  }

  return {
    getItem(name) {
      try {
        const raw = localStorage.getItem(name)
        return raw ? (JSON.parse(raw) as StorageValue<T>) : null
      } catch {
        return null
      }
    },
    setItem(name, value) {
      queued.set(name, value)
      const t = timers.get(name)
      if (t) clearTimeout(t)
      timers.set(name, setTimeout(() => write(name), delay))
    },
    removeItem(name) {
      queued.delete(name)
      try {
        localStorage.removeItem(name)
      } catch {
        /* ignore */
      }
    },
  }
}
