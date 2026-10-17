import { useEffect, useState } from 'react'
import { handleIncomingFile, openFromDisk, save } from '@/lib/actions'
import { readShareFromHash } from '@/lib/files'
import { readLiveHash } from '@/lib/collab/link'
import { useCollab } from '@/store/collab'
import { useDialogs } from '@/store/dialogs'

/** Global keyboard shortcuts. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 's') {
        e.preventDefault()
        void save(e.shiftKey)
      } else if (key === 'k' && !e.shiftKey) {
        e.preventDefault()
        const dialogs = useDialogs.getState()
        if (dialogs.dialog?.type === 'palette') dialogs.close()
        else dialogs.open({ type: 'palette' })
      } else if (key === 'o' && !e.shiftKey) {
        e.preventDefault()
        void openFromDisk()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Open a schema shared via the URL hash, or offer to join a live session. */
export function useIncomingShare() {
  useEffect(() => {
    const check = () => {
      const live = readLiveHash(window.location.hash)
      if (live) {
        const collab = useCollab.getState()
        if (collab.room !== live.room) useDialogs.getState().open({ type: 'live-join', ...live })
        return
      }
      const file = readShareFromHash(window.location.hash)
      if (file) useDialogs.getState().open({ type: 'shared-link', file })
    }
    check()
    window.addEventListener('hashchange', check)
    return () => window.removeEventListener('hashchange', check)
  }, [])
}

/** Drop .dbml / .sql / .json files anywhere on the window. Returns whether a drag is in progress. */
export function useFileDrop() {
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      setDragging(true)
    }
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      const file = e.dataTransfer?.files[0]
      if (file) handleIncomingFile(file.name, await file.text())
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [])
  return dragging
}
