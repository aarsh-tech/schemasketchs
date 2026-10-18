import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { getRelaySockets, joinRoom } from 'trystero/nostr'
import type { JoinRoomConfig } from 'trystero/nostr'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import type * as Y from 'yjs'
import type { Network } from './link'

/* Carries a Yjs document and its awareness between browsers: over WebRTC data
   channels to people elsewhere (Trystero finds them through public Nostr
   relays, encrypting the connection setup with the session key) and over a
   BroadcastChannel to other tabs in this browser, which works offline too.
   Everything received is passed on to everyone else, so two people whose
   networks can't connect directly still sync through a third. */

const APP_ID = 'schemasketch-live'
const SYNC = 0
const AWARENESS = 1

/** where a message came from: a browser elsewhere (p:) or a tab in this one (t:) */
type Origin = `p:${string}` | `t:${string}`
const isOrigin = (o: unknown): o is Origin => typeof o === 'string' && /^[pt]:/.test(o)

interface TabMessage {
  from: string
  /** a tab this is meant for; everyone when absent */
  to?: string
  hello?: true
  bye?: true
  msg?: Uint8Array
}

export interface TransportOptions {
  room: string
  key: string
  network: Network
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  /** someone found the session but no direct connection could be made, and there's no TURN server to fall back on */
  onBlocked: () => void
}

export interface Transport {
  /** how many of the session's relays this browser is connected to */
  relayStatus: () => { connected: number; total: number }
  destroy: () => void
}

export function connect({ room, key, network, doc, awareness, onBlocked }: TransportOptions): Transport {
  const config: JoinRoomConfig = { appId: APP_ID, password: key, relayConfig: { urls: network.relays, warnOnRelayFailure: false } }
  if (network.turn) {
    const { url, username, credential } = network.turn
    config.turnConfig = [{ urls: url, ...(username ? { username } : {}), ...(credential ? { credential } : {}) }]
  }
  const peers = joinRoom(config, room, {
    onJoinError: ({ error }) => {
      if (/could not connect to peer/i.test(error)) onBlocked()
    },
  })
  const wire = peers.makeAction<Uint8Array>('y')
  const tabId = Math.random().toString(36).slice(2)
  const tabs = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`schemasketch-live-${room}`)
  const postTabs = (m: Omit<TabMessage, 'from'>) => tabs?.postMessage({ ...m, from: tabId } satisfies TabMessage)

  const sendTo = (msg: Uint8Array, to: Origin) => {
    if (to.startsWith('p:')) wire.send(msg, { target: to.slice(2) }).catch(() => {})
    else postTabs({ to: to.slice(2), msg })
  }
  /** to every browser and tab except the one the message came from */
  const broadcast = (msg: Uint8Array, except?: Origin) => {
    const targets = Object.keys(peers.getPeers()).filter((id) => `p:${id}` !== except)
    if (targets.length) wire.send(msg, { target: targets }).catch(() => {})
    // tabs all hear each other already
    if (!except?.startsWith('t:')) postTabs({ msg })
  }

  const syncMessage = (write: (encoder: encoding.Encoder) => void) => {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, SYNC)
    write(encoder)
    return encoding.toUint8Array(encoder)
  }
  const awarenessMessage = (clients: number[]) => {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, AWARENESS)
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, clients))
    return encoding.toUint8Array(encoder)
  }

  /** a newcomer gets our state vector (they answer with what we lack) and who's here */
  const greet = (to: Origin) => {
    sendTo(
      syncMessage((e) => syncProtocol.writeSyncStep1(e, doc)),
      to,
    )
    sendTo(awarenessMessage([...awareness.getStates().keys()]), to)
  }

  const receive = (bytes: Uint8Array, from: Origin) => {
    try {
      const decoder = decoding.createDecoder(bytes)
      const type = decoding.readVarUint(decoder)
      if (type === SYNC) {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, SYNC)
        syncProtocol.readSyncMessage(decoder, encoder, doc, from)
        if (encoding.length(encoder) > 1) sendTo(encoding.toUint8Array(encoder), from)
      } else if (type === AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), from)
      }
    } catch (err) {
      console.warn('Schemasketch: ignored a live session message it could not read', err)
    }
  }

  const onUpdate = (update: Uint8Array, origin: unknown) => {
    broadcast(
      syncMessage((e) => syncProtocol.writeUpdate(e, update)),
      isOrigin(origin) ? origin : undefined,
    )
  }
  doc.on('update', onUpdate)

  // whose awareness came through whom, so it can be dropped when they go
  const owners = new Map<Origin, Set<number>>()
  const onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (isOrigin(origin)) {
      const own = owners.get(origin) ?? new Set<number>()
      for (const id of [...added, ...updated]) own.add(id)
      for (const id of removed) own.delete(id)
      owners.set(origin, own)
    } else if (origin !== 'local') {
      // dropped here because a connection closed or went quiet: the others may still see them
      return
    }
    broadcast(awarenessMessage([...added, ...updated, ...removed]), isOrigin(origin) ? origin : undefined)
  }
  awareness.on('update', onAwareness)

  const drop = (origin: Origin) => {
    const ids = owners.get(origin)
    owners.delete(origin)
    if (!ids) return
    const stillSeen = new Set([...owners.values()].flatMap((s) => [...s]))
    const gone = [...ids].filter((id) => !stillSeen.has(id) && id !== doc.clientID)
    if (gone.length) awarenessProtocol.removeAwarenessStates(awareness, gone, 'left')
  }

  wire.onMessage = (data, { peerId }) => receive(data instanceof Uint8Array ? data : new Uint8Array(data as unknown as ArrayBuffer), `p:${peerId}`)
  peers.onPeerJoin = (peerId) => greet(`p:${peerId}`)
  peers.onPeerLeave = (peerId) => drop(`p:${peerId}`)

  if (tabs) {
    tabs.onmessage = ({ data }: MessageEvent<TabMessage>) => {
      if (data.to && data.to !== tabId) return
      const from: Origin = `t:${data.from}`
      if (data.hello) greet(from)
      if (data.msg) receive(data.msg, from)
      if (data.bye) drop(from)
    }
    // the tabs already here greet us back, so both sides learn what the other lacks
    postTabs({ hello: true })
    postTabs({ msg: syncMessage((e) => syncProtocol.writeSyncStep1(e, doc)) })
    postTabs({ msg: awarenessMessage([doc.clientID]) })
  }

  return {
    relayStatus() {
      const sockets = getRelaySockets() as Record<string, WebSocket | undefined>
      return { connected: network.relays.filter((url) => sockets[url]?.readyState === WebSocket.OPEN).length, total: network.relays.length }
    },
    destroy() {
      // tell everyone we've gone before the connections close
      awarenessProtocol.removeAwarenessStates(awareness, [doc.clientID], 'local')
      doc.off('update', onUpdate)
      awareness.off('update', onAwareness)
      postTabs({ bye: true })
      tabs?.close()
      void peers.leave()
    },
  }
}
