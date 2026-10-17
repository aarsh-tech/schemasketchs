import { nanoid } from 'nanoid'
import { create } from 'zustand'
import { addVersion, countTables, loadVersions, needsSnapshot, saveVersions } from '@/lib/history'
import type { Version } from '@/lib/history'
import { useProjects } from './projects'
import { useUi } from './ui'

interface HistoryState {
  /** project whose versions are loaded */
  projectId: string | null
  versions: Version[]
  loading: boolean
  load: (projectId: string) => Promise<void>
  /** Save the project's current source and layout. Auto snapshots are skipped when nothing changed. */
  snapshot: (projectId: string, opts: { auto: boolean; label?: string | null }) => Promise<Version | null>
}

// IndexedDB writes are read-modify-write, so run them one at a time
let queue: Promise<unknown> = Promise.resolve()
const serial = <T>(job: () => Promise<T>): Promise<T> => {
  const run = queue.then(job, job)
  queue = run.catch(() => undefined)
  return run
}

function tableCount(projectId: string, source: string): number {
  const ui = useUi.getState()
  const parsedNow = ui.modelProjectId === projectId && ui.diagnostics.length === 0 && useProjects.getState().projects[projectId]?.lastGoodSource === source
  return parsedNow ? ui.model.tables.length : countTables(source)
}

export const useHistory = create<HistoryState>((set, get) => ({
  projectId: null,
  versions: [],
  loading: false,

  async load(projectId) {
    set({ projectId, versions: [], loading: true })
    const versions = await serial(() => loadVersions(projectId))
    if (get().projectId === projectId) set({ versions, loading: false })
  },

  snapshot(projectId, { auto, label = null }) {
    return serial(async () => {
      const p = useProjects.getState().projects[projectId]
      if (!p) return null
      const list = await loadVersions(projectId)
      if (auto && !needsSnapshot(list, p.source)) return null
      const version: Version = {
        id: nanoid(10),
        createdAt: Date.now(),
        label: label?.trim() || null,
        auto,
        source: p.source,
        positions: { ...p.positions },
        tableCount: tableCount(projectId, p.source),
      }
      const next = addVersion(list, version)
      await saveVersions(projectId, next)
      if (get().projectId === projectId) set({ versions: next })
      return version
    })
  },
}))
