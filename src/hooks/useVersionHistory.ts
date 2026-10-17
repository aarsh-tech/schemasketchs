import { useEffect, useRef } from 'react'
import { IDLE_MS } from '@/lib/history'
import { useHistory } from '@/store/history'
import { useProjects } from '@/store/projects'

const snap = (projectId: string) => useHistory.getState().snapshot(projectId, { auto: true }).catch(() => null)

/** Loads the active project's versions and takes a snapshot once editing pauses. */
export function useVersionHistory() {
  const activeId = useProjects((s) => s.activeId)
  const source = useProjects((s) => s.projects[s.activeId]?.source ?? '')
  /** project with a snapshot still waiting for its idle timer */
  const waiting = useRef<string | null>(null)

  useEffect(() => {
    void useHistory.getState().load(activeId)
  }, [activeId])

  useEffect(() => {
    // switching projects mid-pause: don't lose the other project's snapshot
    if (waiting.current && waiting.current !== activeId) void snap(waiting.current)
    waiting.current = activeId
    const t = setTimeout(() => {
      waiting.current = null
      void snap(activeId)
    }, IDLE_MS)
    return () => clearTimeout(t)
  }, [activeId, source])
}
