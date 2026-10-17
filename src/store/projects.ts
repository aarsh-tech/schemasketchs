import { nanoid } from 'nanoid'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { SAMPLE_DBML, SAMPLE_NAME } from '@/lib/sample'
import { createDebouncedStorage } from '@/lib/storage'

export interface XY {
  x: number
  y: number
}

export interface Project {
  id: string
  name: string
  source: string
  /** node id (table key or note:name) → top-left position on the canvas */
  positions: Record<string, XY>
  /** last source that parsed cleanly, used to keep a diagram on screen after a reload with errors */
  lastGoodSource?: string
  createdAt: number
  updatedAt: number
}

interface ProjectsState {
  projects: Record<string, Project>
  activeId: string
  createProject: (input?: Partial<Pick<Project, 'name' | 'source' | 'positions'>>) => string
  duplicateProject: (id: string) => string
  deleteProject: (id: string) => void
  renameProject: (id: string, name: string) => void
  setActive: (id: string) => void
  setSource: (source: string) => void
  setPositions: (positions: Record<string, XY>, opts?: { replace?: boolean }) => void
  replaceProject: (id: string, patch: Partial<Pick<Project, 'source' | 'positions' | 'name'>>) => void
  markGood: (id: string, source: string) => void
}

const now = () => Date.now()

function makeProject(input: Partial<Pick<Project, 'name' | 'source' | 'positions'>> = {}): Project {
  const t = now()
  return {
    id: nanoid(10),
    name: input.name?.trim() || 'Untitled schema',
    source: input.source ?? '',
    positions: input.positions ?? {},
    createdAt: t,
    updatedAt: t,
  }
}

const first = makeProject({ name: SAMPLE_NAME, source: SAMPLE_DBML })

export const useProjects = create<ProjectsState>()(
  persist(
    (set, get) => ({
      projects: { [first.id]: first },
      activeId: first.id,

      createProject(input) {
        const p = makeProject(input)
        set((s) => ({ projects: { ...s.projects, [p.id]: p }, activeId: p.id }))
        return p.id
      },

      duplicateProject(id) {
        const src = get().projects[id]
        if (!src) return get().activeId
        return get().createProject({
          name: `${src.name} copy`,
          source: src.source,
          positions: { ...src.positions },
        })
      },

      deleteProject(id) {
        set((s) => {
          const rest = { ...s.projects }
          delete rest[id]
          if (Object.keys(rest).length === 0) {
            const blank = makeProject({ name: 'Untitled schema' })
            return { projects: { [blank.id]: blank }, activeId: blank.id }
          }
          const activeId =
            s.activeId === id
              ? Object.values(rest).sort((a, b) => b.updatedAt - a.updatedAt)[0].id
              : s.activeId
          return { projects: rest, activeId }
        })
      },

      renameProject(id, name) {
        const trimmed = name.trim()
        if (!trimmed) return
        set((s) => {
          const p = s.projects[id]
          if (!p || p.name === trimmed) return s
          return { projects: { ...s.projects, [id]: { ...p, name: trimmed, updatedAt: now() } } }
        })
      },

      setActive(id) {
        if (get().projects[id]) set({ activeId: id })
      },

      setSource(source) {
        set((s) => {
          const p = s.projects[s.activeId]
          if (!p || p.source === source) return s
          return { projects: { ...s.projects, [p.id]: { ...p, source, updatedAt: now() } } }
        })
      },

      setPositions(positions, opts) {
        set((s) => {
          const p = s.projects[s.activeId]
          if (!p) return s
          const next = opts?.replace ? positions : { ...p.positions, ...positions }
          return { projects: { ...s.projects, [p.id]: { ...p, positions: next, updatedAt: now() } } }
        })
      },

      markGood(id, source) {
        set((s) => {
          const p = s.projects[id]
          if (!p || p.lastGoodSource === source) return s
          return { projects: { ...s.projects, [id]: { ...p, lastGoodSource: source } } }
        })
      },

      replaceProject(id, patch) {
        set((s) => {
          const p = s.projects[id]
          if (!p) return s
          return { projects: { ...s.projects, [id]: { ...p, ...patch, lastGoodSource: undefined, updatedAt: now() } } }
        })
      },
    }),
    {
      name: 'schemasketch:projects',
      version: 1,
      storage: createDebouncedStorage(),
      partialize: (s) => ({ projects: s.projects, activeId: s.activeId }) as ProjectsState,
      merge: (persisted, current) => {
        const p = persisted as Partial<ProjectsState> | undefined
        if (!p?.projects || Object.keys(p.projects).length === 0) return current
        const activeId = p.activeId && p.projects[p.activeId] ? p.activeId : Object.keys(p.projects)[0]
        return { ...current, projects: p.projects, activeId }
      },
    },
  ),
)

export const useActiveProject = () => useProjects((s) => s.projects[s.activeId])
