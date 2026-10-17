import { nanoid } from 'nanoid'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { SAMPLE_DBML, SAMPLE_NAME } from '@/lib/sample'
import { createDebouncedStorage } from '@/lib/storage'
import { renameInViews } from '@/lib/views'
import type { SchemaView, XY } from '@/lib/views'

export type { SchemaView, XY } from '@/lib/views'

export interface Project {
  id: string
  name: string
  source: string
  /** node id (table key or note:name) → top-left position on the canvas */
  positions: Record<string, XY>
  /** last source that parsed cleanly, used to keep a diagram on screen after a reload with errors */
  lastGoodSource?: string
  /** schema lint rules switched off for this project */
  lintOff?: string[]
  /** named subsets of the tables, each with its own layout */
  views?: SchemaView[]
  /** view shown on the canvas; null or missing shows every table */
  activeView?: string | null
  /** room of the live session this schema is shared in, while it is */
  liveRoom?: string
  createdAt: number
  updatedAt: number
}

interface ProjectsState {
  projects: Record<string, Project>
  activeId: string
  createProject: (input?: Partial<Pick<Project, 'name' | 'source' | 'positions' | 'views'>>) => string
  duplicateProject: (id: string) => string
  deleteProject: (id: string) => void
  renameProject: (id: string, name: string) => void
  setActive: (id: string) => void
  setSource: (source: string) => void
  /** Save node positions for the view on screen; `all` writes the full diagram's layout instead. */
  setPositions: (positions: Record<string, XY>, opts?: { replace?: boolean; all?: boolean }) => void
  /** Move a table's saved positions and view membership to its new id. */
  renameTableKey: (from: string, to: string) => void
  replaceProject: (id: string, patch: Partial<Pick<Project, 'source' | 'positions' | 'name'>>) => void
  markGood: (id: string, source: string) => void
  setLintRule: (id: string, rule: string, on: boolean) => void
  createView: (name: string, tableIds: string[]) => string
  updateView: (viewId: string, patch: Partial<Pick<SchemaView, 'name' | 'tableIds'>>) => void
  deleteView: (viewId: string) => void
  setActiveView: (viewId: string | null) => void
  /** Change a project that may not be the one on screen (live sessions). Leaves its parse state alone. */
  patchProject: (id: string, patch: Partial<Pick<Project, 'source' | 'liveRoom'>>) => void
  /** Merge full-diagram positions into a project that may not be the one on screen. */
  mergePositions: (id: string, positions: Record<string, XY>) => void
}

/** The view a project shows, if it's showing one. */
export const activeViewOf = (p: Project | undefined): SchemaView | null => (p?.activeView ? (p.views?.find((v) => v.id === p.activeView) ?? null) : null)

/** Positions for what's on the canvas: the active view's layout, or the full diagram's. */
export const positionsOf = (p: Project | undefined): Record<string, XY> => activeViewOf(p)?.positions ?? p?.positions ?? {}

const now = () => Date.now()

function makeProject(input: Partial<Pick<Project, 'name' | 'source' | 'positions' | 'views'>> = {}): Project {
  const t = now()
  return {
    id: nanoid(10),
    name: input.name?.trim() || 'Untitled schema',
    source: input.source ?? '',
    positions: input.positions ?? {},
    ...(input.views?.length ? { views: input.views } : {}),
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
          views: src.views?.map((v) => ({ ...v, tableIds: [...v.tableIds], positions: { ...v.positions } })),
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
          const view = opts?.all ? null : activeViewOf(p)
          if (view) {
            const next = opts?.replace ? positions : { ...view.positions, ...positions }
            const views = p.views!.map((v) => (v.id === view.id ? { ...v, positions: next } : v))
            return { projects: { ...s.projects, [p.id]: { ...p, views, updatedAt: now() } } }
          }
          const next = opts?.replace ? positions : { ...p.positions, ...positions }
          return { projects: { ...s.projects, [p.id]: { ...p, positions: next, updatedAt: now() } } }
        })
      },

      renameTableKey(from, to) {
        set((s) => {
          const p = s.projects[s.activeId]
          if (!p) return s
          const positions = { ...p.positions }
          if (positions[from] && !positions[to]) positions[to] = positions[from]
          delete positions[from]
          const views = p.views ? renameInViews(p.views, from, to) : p.views
          return { projects: { ...s.projects, [p.id]: { ...p, positions, views } } }
        })
      },

      createView(name, tableIds) {
        const id = nanoid(8)
        set((s) => {
          const p = s.projects[s.activeId]
          if (!p) return s
          const view: SchemaView = { id, name: name.trim() || 'View', tableIds: [...new Set(tableIds)], positions: {} }
          return { projects: { ...s.projects, [p.id]: { ...p, views: [...(p.views ?? []), view], activeView: id, updatedAt: now() } } }
        })
        return id
      },

      updateView(viewId, patch) {
        set((s) => {
          const p = s.projects[s.activeId]
          if (!p?.views?.some((v) => v.id === viewId)) return s
          const views = p.views.map((v) =>
            v.id === viewId
              ? { ...v, ...(patch.name !== undefined ? { name: patch.name.trim() || v.name } : {}), ...(patch.tableIds ? { tableIds: [...new Set(patch.tableIds)] } : {}) }
              : v,
          )
          return { projects: { ...s.projects, [p.id]: { ...p, views, updatedAt: now() } } }
        })
      },

      deleteView(viewId) {
        set((s) => {
          const p = s.projects[s.activeId]
          if (!p?.views) return s
          const views = p.views.filter((v) => v.id !== viewId)
          return { projects: { ...s.projects, [p.id]: { ...p, views, activeView: p.activeView === viewId ? null : p.activeView, updatedAt: now() } } }
        })
      },

      patchProject(id, patch) {
        set((s) => {
          const p = s.projects[id]
          if (!p) return s
          const next = { ...p, ...patch, updatedAt: now() }
          if ('liveRoom' in patch && !patch.liveRoom) delete next.liveRoom
          return { projects: { ...s.projects, [id]: next } }
        })
      },

      mergePositions(id, positions) {
        set((s) => {
          const p = s.projects[id]
          if (!p) return s
          return { projects: { ...s.projects, [id]: { ...p, positions: { ...p.positions, ...positions } } } }
        })
      },

      setActiveView(viewId) {
        set((s) => {
          const p = s.projects[s.activeId]
          if (!p || (p.activeView ?? null) === viewId) return s
          return { projects: { ...s.projects, [p.id]: { ...p, activeView: viewId } } }
        })
      },

      markGood(id, source) {
        set((s) => {
          const p = s.projects[id]
          if (!p || p.lastGoodSource === source) return s
          return { projects: { ...s.projects, [id]: { ...p, lastGoodSource: source } } }
        })
      },

      setLintRule(id, rule, on) {
        set((s) => {
          const p = s.projects[id]
          if (!p) return s
          const off = new Set(p.lintOff ?? [])
          if (on) off.delete(rule)
          else off.add(rule)
          return { projects: { ...s.projects, [id]: { ...p, lintOff: [...off] } } }
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
      // v2 added the optional lintOff list, v3 the optional views, v4 the optional liveRoom; older projects load unchanged
      version: 4,
      migrate: (persisted) => persisted as ProjectsState,
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
