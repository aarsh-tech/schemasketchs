import type { Extension } from '@codemirror/state'
import { Prec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { keymap } from '@codemirror/view'
import { yCollab, ySyncAnnotation, ySyncFacet, yUndoManagerKeymap } from 'y-codemirror.next'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import type { XY } from '@/lib/views'
import type { Network } from './link'
import { connect } from './transport'

/* A live session: one Yjs document holding the DBML text and the table
   positions, shared peer to peer (see transport.ts). Loaded on demand; the
   app talks to it through store/collab.ts. */

export interface Me {
  name: string
  color: string
}

export interface Peer extends Me {
  id: number
  /** table the peer has selected, or is editing in the code */
  table: string | null
}

export interface SessionOptions {
  room: string
  /** shared secret from the link: relays only ever see encrypted connection setup */
  key: string
  network: Network
  me: Me
  /** the host fills the shared document from their schema; people joining start empty */
  seed?: { source: string; positions: Record<string, XY> }
  onPeers: (peers: Peer[]) => void
  onRemotePositions: (positions: Record<string, XY>) => void
  /** someone found the session but their network and ours couldn't connect directly */
  onBlocked: () => void
}

export interface Session {
  text: () => string
  positions: () => Record<string, XY>
  /** CodeMirror extension: shared text, remote cursors and an undo that only undoes your own edits */
  editorExtension: Extension
  /** make a freshly mounted editor match the shared text */
  alignEditor: (view: EditorView) => void
  undo: () => boolean
  setPositions: (positions: Record<string, XY>) => void
  setTable: (table: string | null) => void
  setMe: (me: Me) => void
  /** how many relays are reachable (people on other devices need at least one in common) */
  relayStatus: () => { connected: number; total: number }
  peerCount: () => number
  onTextChange: (cb: () => void) => () => void
  destroy: () => void
}

const LOCAL = Symbol('schemasketch-local')

export function startSession(opts: SessionOptions): Session {
  const doc = new Y.Doc()
  const ytext = doc.getText('dbml')
  const ypos = doc.getMap<XY>('positions')
  if (opts.seed) {
    doc.transact(() => {
      ytext.insert(0, opts.seed!.source)
      for (const [id, p] of Object.entries(opts.seed!.positions)) ypos.set(id, { x: p.x, y: p.y })
    }, LOCAL)
  }

  const awareness = new Awareness(doc)
  const light = (c: string) => `${c}33`
  awareness.setLocalStateField('user', { name: opts.me.name, color: opts.me.color, colorLight: light(opts.me.color) })
  awareness.setLocalStateField('table', null)

  const publishPeers = () => {
    const peers: Peer[] = []
    awareness.getStates().forEach((state, id) => {
      if (id === doc.clientID) return
      const user = state.user as { name?: string; color?: string } | undefined
      if (!user?.name) return
      peers.push({ id, name: user.name, color: user.color ?? '#888888', table: (state.table as string | null) ?? null })
    })
    opts.onPeers(peers)
  }
  awareness.on('change', publishPeers)

  ypos.observe((event) => {
    if (event.transaction.origin === LOCAL) return
    const changed: Record<string, XY> = {}
    event.changes.keys.forEach((change, key) => {
      if (change.action === 'delete') return
      const p = ypos.get(key)
      if (p) changed[key] = p
    })
    if (Object.keys(changed).length) opts.onRemotePositions(changed)
  })

  const transport = connect({ room: opts.room, key: opts.key, network: opts.network, doc, awareness, onBlocked: opts.onBlocked })

  const undoManager = new Y.UndoManager(ytext)
  const editorExtension: Extension = [yCollab(ytext, awareness, { undoManager }), Prec.high(keymap.of(yUndoManagerKeymap))]

  return {
    text: () => ytext.toString(),
    positions: () => Object.fromEntries(ypos.entries()),
    editorExtension,
    alignEditor(view) {
      const shared = ytext.toString()
      const current = view.state.doc.toString()
      if (shared === current) return
      // annotated with the sync plugin's own config, so it isn't sent back to the others
      view.dispatch({ changes: { from: 0, to: current.length, insert: shared }, annotations: [ySyncAnnotation.of(view.state.facet(ySyncFacet))] })
    },
    undo: () => undoManager.undo() !== null,
    setPositions(positions) {
      doc.transact(() => {
        for (const [id, p] of Object.entries(positions)) {
          const cur = ypos.get(id)
          if (!cur || cur.x !== p.x || cur.y !== p.y) ypos.set(id, { x: p.x, y: p.y })
        }
      }, LOCAL)
    },
    setTable: (table) => awareness.setLocalStateField('table', table),
    setMe: (me) => awareness.setLocalStateField('user', { name: me.name, color: me.color, colorLight: light(me.color) }),
    relayStatus: () => transport.relayStatus(),
    peerCount: () => Math.max(0, awareness.getStates().size - 1),
    onTextChange(cb) {
      ytext.observe(cb)
      return () => ytext.unobserve(cb)
    },
    destroy() {
      awareness.off('change', publishPeers)
      transport.destroy()
      awareness.destroy()
      doc.destroy()
    },
  }
}
