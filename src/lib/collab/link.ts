/* Live session links and identities. Small and pure, so it stays in the main
   bundle; everything that talks to the network is in session.ts. */

/**
 * Public Nostr relays the browsers use to find each other. They only pass on
 * the encrypted connection setup; edits go browser to browser. All of these
 * forwarded the short-lived events this needs when checked on 2026-10-18, and
 * a session keeps working while any one of them is up.
 */
export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://relay.snort.social',
  'wss://nostr.oxtr.dev',
  'wss://relay.nostr.net',
  'wss://offchain.pub',
]

/** A TURN server relays the connection itself, for networks that block direct ones. */
export interface Turn {
  url: string
  username: string
  credential: string
}

/** How a session's browsers reach each other. Everyone in a session uses the same one. */
export interface Network {
  relays: string[]
  turn: Turn | null
}

export const DEFAULT_NETWORK: Network = { relays: DEFAULT_RELAYS, turn: null }

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * #live=<room>.<key>, plus &relays= when the session doesn't use the default
 * relays and &turn=&tu=&tc= when it has a TURN server. The key never reaches a
 * server; it only encrypts what passes through one.
 */
export function liveHash(room: string, key: string, network: Network = DEFAULT_NETWORK): string {
  let hash = `live=${room}.${key}`
  if (network.relays.length && !sameList(network.relays, DEFAULT_RELAYS)) hash += `&relays=${encodeURIComponent(network.relays.join(' '))}`
  if (network.turn) {
    hash += `&turn=${encodeURIComponent(network.turn.url)}`
    if (network.turn.username) hash += `&tu=${encodeURIComponent(network.turn.username)}`
    if (network.turn.credential) hash += `&tc=${encodeURIComponent(network.turn.credential)}`
  }
  return hash
}

export function readLiveHash(hash: string): { room: string; key: string; network: Network } | null {
  const m = /(?:^#?|&)live=([A-Za-z0-9_-]{8,64})\.([A-Za-z0-9_-]{8,128})(?:&|$)/.exec(hash)
  if (!m) return null
  // links from before relays carried &sig=<y-webrtc server>; those servers are gone, so it's ignored
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const relays = parseRelays(params.get('relays') ?? '')
  const turn = parseTurn(params.get('turn') ?? '', params.get('tu') ?? '', params.get('tc') ?? '')
  return { room: m[1], key: m[2], network: { relays: relays.length ? relays : DEFAULT_RELAYS, turn } }
}

/** Relay addresses typed one per line (or comma separated); only ws:// and wss:// URLs count. */
export function parseRelays(text: string): string[] {
  const urls = text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /^wss?:\/\/[^\s/]+/i.test(s))
  return [...new Set(urls)]
}

/** A TURN server from the form, or null when the address isn't a turn: or turns: URL. */
export function parseTurn(url: string, username: string, credential: string): Turn | null {
  const clean = url.trim()
  if (!/^turns?:[^\s]+$/i.test(clean)) return null
  return { url: clean, username: username.trim(), credential: credential.trim() }
}

const ADJECTIVES = ['Quiet', 'Brisk', 'Bright', 'Calm', 'Clever', 'Gentle', 'Keen', 'Lively', 'Merry', 'Nimble', 'Swift', 'Witty']
const ANIMALS = ['Heron', 'Otter', 'Lynx', 'Robin', 'Badger', 'Falcon', 'Marten', 'Wren', 'Ibex', 'Puffin', 'Koala', 'Orca']
/** cursor colours that read on both the light and the dark editor */
export const PEER_COLORS = ['#d9480f', '#2f7dd1', '#9c36b5', '#2b8a3e', '#c2255c', '#0c8599', '#b8860b', '#5f3dc4']

export function randomIdentity(rand: () => number = Math.random): { name: string; color: string } {
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length) % list.length]
  return { name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`, color: pick(PEER_COLORS) }
}

/**
 * A name and colour nobody else in the session has, for someone who just
 * joined (often another tab of the same browser, which shares the saved name).
 * Null when theirs are already distinct.
 */
export function distinctIdentity(
  me: { name: string; color: string },
  others: { name: string; color: string }[],
  rand: () => number = Math.random,
): { name: string; color: string } | null {
  const names = new Set(others.map((o) => o.name.toLowerCase()))
  const colors = new Set(others.map((o) => o.color))
  const nameTaken = names.has(me.name.toLowerCase())
  const colorTaken = colors.has(me.color)
  if (!nameTaken && !colorTaken) return null
  let name = me.name
  for (let i = 0; nameTaken && i < 50; i++) {
    const candidate = randomIdentity(rand).name
    if (!names.has(candidate.toLowerCase())) {
      name = candidate
      break
    }
  }
  const free = PEER_COLORS.filter((c) => !colors.has(c))
  const color = colorTaken && free.length ? free[Math.floor(rand() * free.length) % free.length] : me.color
  return { name, color }
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?'
