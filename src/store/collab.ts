import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { nanoid } from 'nanoid'
import { toast } from 'sonner'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { setUndoOverride } from '@/components/editor/bridge'
import { DEFAULT_SIGNALING, liveHash, parseSignaling, randomIdentity } from '@/lib/collab/link'
import type { Peer, Session } from '@/lib/collab/session'
import type { XY } from '@/lib/views'
import { useProjects } from './projects'
import { useUi } from './ui'

/* Live collaboration. The Yjs session itself (yjs, y-webrtc, the CodeMirror
   binding) is loaded only when someone starts or joins one. */

export type { Peer } from '@/lib/collab/session'

interface CollabState {
  status: 'off' | 'connecting' | 'live'
  room: string | null
  key: string | null
  /** the schema that's shared */
  projectId: string | null
  peers: Peer[]
  /** null until the first check */
  signalingOk: boolean | null
  /** CodeMirror extension for the shared project's editor */
  editorExtension: Extension | null

  /* remembered in this browser */
  name: string
  color: string
  signaling: string

  /** signalling servers of the running session */
  servers: string[]
  start: () => Promise<void>
  join: (room: string, key: string, signaling: string[]) => Promise<void>
  leave: (opts?: { quiet?: boolean }) => void
  setName: (name: string) => void
  setSignaling: (text: string) => void
}

let session: Session | null = null
let cleanup: (() => void)[] = []
const moveListeners = new Set<(projectId: string, positions: Record<string, XY>) => void>()

/** The canvas listens here to move tables when someone else moves them. */
export function onRemoteMoves(cb: (projectId: string, positions: Record<string, XY>) => void): () => void {
  moveListeners.add(cb)
  return () => moveListeners.delete(cb)
}

/** Tell the others which table you're looking at. */
export function shareSelectedTable(table: string | null) {
  session?.setTable(table)
}

/** Bring a freshly mounted editor in line with the shared text. */
export function alignSharedEditor(view: EditorView) {
  session?.alignEditor(view)
}

const identity = randomIdentity()

export const useCollab = create<CollabState>()(
  persist(
    (set, get) => {
      async function open(projectId: string, room: string, key: string, seed: boolean, servers: string[]) {
        get().leave({ quiet: true })
        set({ status: 'connecting', room, key, projectId, peers: [], signalingOk: null, servers })
        const { startSession } = await import('@/lib/collab/session')
        const project = useProjects.getState().projects[projectId]
        if (!project || get().room !== room) return
        const s = get()
        session = startSession({
          room,
          key,
          signaling: servers,
          me: { name: s.name, color: s.color },
          seed: seed ? { source: project.source, positions: project.positions } : undefined,
          onPeers: (peers) => set({ peers }),
          onRemotePositions: (positions) => {
            useProjects.getState().mergePositions(projectId, positions)
            moveListeners.forEach((cb) => cb(projectId, positions))
          },
        })
        const live = session
        setUndoOverride(() => live.undo())
        useProjects.getState().patchProject(projectId, { liveRoom: room, ...(seed ? {} : { source: live.text() }) })

        // our moves go to the others; positions that came from them come back unchanged and are skipped
        cleanup.push(
          useProjects.subscribe((state, prev) => {
            const now = state.projects[projectId]?.positions
            if (now && now !== prev.projects[projectId]?.positions) live.setPositions(now)
          }),
        )
        // while another schema is on screen, keep this one's text up to date
        cleanup.push(
          live.onTextChange(() => {
            if (useProjects.getState().activeId !== projectId) useProjects.getState().patchProject(projectId, { source: live.text() })
          }),
        )
        const timer = setInterval(() => set({ signalingOk: live.signalingConnected() }), 1500)
        cleanup.push(() => clearInterval(timer))

        set({ status: 'live', editorExtension: live.editorExtension })
        history.replaceState(null, '', `${location.pathname}${location.search}#${liveHash(room, key, servers)}`)
        // remount the editor with the shared binding
        if (useProjects.getState().activeId === projectId) useUi.getState().bumpEditor()
      }

      return {
        status: 'off',
        room: null,
        key: null,
        projectId: null,
        peers: [],
        signalingOk: null,
        editorExtension: null,
        servers: DEFAULT_SIGNALING,
        name: identity.name,
        color: identity.color,
        signaling: DEFAULT_SIGNALING.join('\n'),

        async start() {
          const { activeId } = useProjects.getState()
          const servers = parseSignaling(get().signaling)
          await open(activeId, nanoid(16), nanoid(24), true, servers.length ? servers : DEFAULT_SIGNALING)
        },

        async join(room, key, signaling) {
          const store = useProjects.getState()
          // rejoining a room this browser was already in reuses that schema
          const existing = Object.values(store.projects).find((p) => p.liveRoom === room)
          const id = existing?.id ?? store.createProject({ name: 'Live session', source: '' })
          store.setActive(id)
          await open(id, room, key, false, signaling)
        },

        leave(opts) {
          const { projectId, status } = get()
          if (status === 'off') return
          cleanup.forEach((fn) => fn())
          cleanup = []
          session?.destroy()
          session = null
          setUndoOverride(null)
          set({ status: 'off', room: null, key: null, projectId: null, peers: [], signalingOk: null, editorExtension: null })
          if (projectId) useProjects.getState().patchProject(projectId, { liveRoom: undefined })
          if (/live=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search)
          if (projectId && useProjects.getState().activeId === projectId) useUi.getState().bumpEditor()
          if (!opts?.quiet) toast.success('Left the live session', { description: 'Your copy of the schema stays in this browser.' })
        },

        setName(name) {
          const clean = name.trim().slice(0, 40)
          if (!clean) return
          set({ name: clean })
          session?.setMe({ name: clean, color: get().color })
        },

        setSignaling: (signaling) => set({ signaling }),
      }
    },
    {
      name: 'schemasketch:collab',
      partialize: (s) => ({ name: s.name, color: s.color, signaling: s.signaling }) as CollabState,
    },
  ),
)
