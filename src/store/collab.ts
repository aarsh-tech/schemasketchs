import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { nanoid } from 'nanoid'
import { toast } from 'sonner'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { setUndoOverride } from '@/components/editor/bridge'
import { DEFAULT_NETWORK, distinctIdentity, liveHash, parseRelays, parseTurn, randomIdentity } from '@/lib/collab/link'
import type { Network, Turn } from '@/lib/collab/link'
import type { Peer, Session } from '@/lib/collab/session'
import type { XY } from '@/lib/views'
import { useProjects } from './projects'
import { useUi } from './ui'

/* Live collaboration. The Yjs session itself (yjs, Trystero, the CodeMirror
   binding) is loaded only when someone starts or joins one. */

export type { Peer } from '@/lib/collab/session'

interface CollabState {
  status: 'off' | 'connecting' | 'live'
  room: string | null
  key: string | null
  /** the schema that's shared */
  projectId: string | null
  peers: Peer[]
  /** relays this browser reaches; null until the first check */
  relays: { connected: number; total: number } | null
  /** someone found the session but couldn't connect directly (a TURN server fixes that) */
  blocked: boolean
  /** CodeMirror extension for the shared project's editor */
  editorExtension: Extension | null

  /* remembered in this browser */
  name: string
  color: string
  /** relays for sessions started here, one per line; empty means the defaults */
  relayText: string
  /** TURN server for sessions started here; an empty url means none */
  turn: Turn

  /** how the running session's browsers reach each other */
  network: Network
  start: () => Promise<void>
  join: (room: string, key: string, network: Network) => Promise<void>
  leave: (opts?: { quiet?: boolean }) => void
  setName: (name: string) => void
  setNetworkSettings: (settings: { relayText?: string; turn?: Turn }) => void
}

/** the network a new session uses, from what's typed in the dialog */
export function networkFromSettings(relayText: string, turn: Turn): Network {
  const relays = parseRelays(relayText)
  return { relays: relays.length ? relays : DEFAULT_NETWORK.relays, turn: parseTurn(turn.url, turn.username, turn.credential) }
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
      async function open(projectId: string, room: string, key: string, seed: boolean, network: Network) {
        get().leave({ quiet: true })
        set({ status: 'connecting', room, key, projectId, peers: [], relays: null, blocked: false, network })
        const { startSession } = await import('@/lib/collab/session')
        const project = useProjects.getState().projects[projectId]
        if (!project || get().room !== room) return
        const s = get()
        let checkedIdentity = seed
        session = startSession({
          room,
          key,
          network,
          me: { name: s.name, color: s.color },
          seed: seed ? { source: project.source, positions: project.positions } : undefined,
          onPeers: (peers) => {
            // joining with a name or colour that's already here (another tab of this browser shares the saved name) gets a new one
            if (!checkedIdentity && peers.length) {
              checkedIdentity = true
              const me = get()
              const fresh = distinctIdentity(me, peers)
              if (fresh) {
                set(fresh)
                session?.setMe(fresh)
                if (fresh.name !== me.name)
                  toast(`You’re ${fresh.name} in this session`, { description: `Someone here is already called ${me.name}. Change your name in the live session dialog.` })
              }
            }
            set(peers.length > get().peers.length ? { peers, blocked: false } : { peers })
          },
          onBlocked: () => set({ blocked: true }),
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
        const checkRelays = () => {
          const now = live.relayStatus()
          const was = get().relays
          if (!was || was.connected !== now.connected || was.total !== now.total) set({ relays: now })
        }
        const timer = setInterval(checkRelays, 1500)
        cleanup.push(() => clearInterval(timer))

        set({ status: 'live', editorExtension: live.editorExtension })
        history.replaceState(null, '', `${location.pathname}${location.search}#${liveHash(room, key, network)}`)
        // remount the editor with the shared binding
        if (useProjects.getState().activeId === projectId) useUi.getState().bumpEditor()
      }

      return {
        status: 'off',
        room: null,
        key: null,
        projectId: null,
        peers: [],
        relays: null,
        blocked: false,
        editorExtension: null,
        network: DEFAULT_NETWORK,
        name: identity.name,
        color: identity.color,
        relayText: '',
        turn: { url: '', username: '', credential: '' },

        async start() {
          const { activeId } = useProjects.getState()
          const { relayText, turn } = get()
          await open(activeId, nanoid(16), nanoid(24), true, networkFromSettings(relayText, turn))
        },

        async join(room, key, network) {
          const store = useProjects.getState()
          // rejoining a room this browser was already in reuses that schema
          const existing = Object.values(store.projects).find((p) => p.liveRoom === room)
          const id = existing?.id ?? store.createProject({ name: 'Live session', source: '' })
          store.setActive(id)
          await open(id, room, key, false, network)
        },

        leave(opts) {
          const { projectId, status } = get()
          if (status === 'off') return
          cleanup.forEach((fn) => fn())
          cleanup = []
          session?.destroy()
          session = null
          setUndoOverride(null)
          set({ status: 'off', room: null, key: null, projectId: null, peers: [], relays: null, blocked: false, editorExtension: null })
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

        setNetworkSettings: (settings) => set(settings),
      }
    },
    {
      name: 'schemasketch:collab',
      version: 1,
      partialize: (s) => ({ name: s.name, color: s.color, relayText: s.relayText, turn: s.turn }) as CollabState,
      // version 0 kept y-webrtc signalling servers, which aren't Nostr relays: keep only the identity
      migrate: (persisted, version) => {
        const old = (persisted ?? {}) as Partial<CollabState>
        if (version < 1) return { name: old.name ?? identity.name, color: old.color ?? identity.color } as CollabState
        return old as CollabState
      },
    },
  ),
)
