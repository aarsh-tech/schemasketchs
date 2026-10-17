/* Live session links and identities. Small and pure, so it stays in the main
   bundle; everything that talks to the network is in session.ts. */

export const DEFAULT_SIGNALING = ['wss://signaling.yjs.dev']

/**
 * #live=<room>.<key>, plus &sig=<servers> when the session doesn't use the
 * default signalling server (everyone has to use the same one). The key never
 * reaches a server; it only encrypts what passes through one.
 */
export function liveHash(room: string, key: string, signaling: string[] = DEFAULT_SIGNALING): string {
  const custom = signaling.length && signaling.join(' ') !== DEFAULT_SIGNALING.join(' ')
  return `live=${room}.${key}${custom ? `&sig=${encodeURIComponent(signaling.join(' '))}` : ''}`
}

export function readLiveHash(hash: string): { room: string; key: string; signaling: string[] } | null {
  const m = /(?:^#?|&)live=([A-Za-z0-9_-]{8,64})\.([A-Za-z0-9_-]{8,128})(?:&|$)/.exec(hash)
  if (!m) return null
  const sig = /(?:^#?|&)sig=([^&]*)/.exec(hash)?.[1]
  let signaling: string[] = []
  try {
    signaling = sig ? parseSignaling(decodeURIComponent(sig)) : []
  } catch {
    /* a mangled sig falls back to the default server */
  }
  return { room: m[1], key: m[2], signaling: signaling.length ? signaling : DEFAULT_SIGNALING }
}

const ADJECTIVES = ['Quiet', 'Brisk', 'Bright', 'Calm', 'Clever', 'Gentle', 'Keen', 'Lively', 'Merry', 'Nimble', 'Swift', 'Witty']
const ANIMALS = ['Heron', 'Otter', 'Lynx', 'Robin', 'Badger', 'Falcon', 'Marten', 'Wren', 'Ibex', 'Puffin', 'Koala', 'Orca']
/** cursor colours that read on both the light and the dark editor */
export const PEER_COLORS = ['#d9480f', '#2f7dd1', '#9c36b5', '#2b8a3e', '#c2255c', '#0c8599', '#b8860b', '#5f3dc4']

export function randomIdentity(rand: () => number = Math.random): { name: string; color: string } {
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length) % list.length]
  return { name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`, color: pick(PEER_COLORS) }
}

/** Signalling servers typed one per line (or comma separated); only ws:// and wss:// URLs count. */
export function parseSignaling(text: string): string[] {
  const urls = text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /^wss?:\/\/[^\s/]+/i.test(s))
  return [...new Set(urls)]
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?'
