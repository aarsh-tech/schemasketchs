import { describe, expect, it } from 'vitest'
import { DEFAULT_RELAYS, PEER_COLORS, distinctIdentity, initials, liveHash, parseRelays, parseTurn, randomIdentity, readLiveHash } from './link'

describe('live links', () => {
  it('round-trips a room and key through the hash', () => {
    const hash = `#${liveHash('Ab3_dEf-12345678', 'k3y_With-Dashes_0123456789')}`
    expect(hash).toBe('#live=Ab3_dEf-12345678.k3y_With-Dashes_0123456789')
    expect(readLiveHash(hash)).toEqual({ room: 'Ab3_dEf-12345678', key: 'k3y_With-Dashes_0123456789', network: { relays: DEFAULT_RELAYS, turn: null } })
  })

  it('carries non-default relays in the link', () => {
    const hash = liveHash('room12345678', 'key12345678', { relays: ['wss://relay.example', 'ws://localhost:7777'], turn: null })
    expect(hash).toContain('&relays=')
    expect(readLiveHash(`#${hash}`)?.network.relays).toEqual(['wss://relay.example', 'ws://localhost:7777'])
    expect(liveHash('room12345678', 'key12345678', { relays: [...DEFAULT_RELAYS], turn: null })).not.toContain('relays=')
    expect(readLiveHash('#live=room12345678.key12345678&relays=%E0%A4%A')?.network.relays).toEqual(DEFAULT_RELAYS)
  })

  it('carries a TURN server, with credentials that need escaping', () => {
    const turn = { url: 'turns:turn.example.com:443?transport=tcp', username: 'ada', credential: 'p&ss=w+rd/ü' }
    const hash = liveHash('room12345678', 'key12345678', { relays: DEFAULT_RELAYS, turn })
    expect(readLiveHash(`#${hash}`)?.network).toEqual({ relays: DEFAULT_RELAYS, turn })
    expect(readLiveHash('#live=room12345678.key12345678&turn=https%3A%2F%2Fnope')?.network.turn).toBeNull()
  })

  it('still opens links from before relays, ignoring their signalling server', () => {
    expect(readLiveHash('#live=room12345678.key12345678&sig=ws%3A%2F%2Flocalhost%3A4444')).toEqual({
      room: 'room12345678',
      key: 'key12345678',
      network: { relays: DEFAULT_RELAYS, turn: null },
    })
  })

  it('ignores share links and malformed values', () => {
    expect(readLiveHash('#s=abc')).toBeNull()
    expect(readLiveHash('#live=short.key')).toBeNull()
    expect(readLiveHash('#live=roomroomroom')).toBeNull()
    expect(readLiveHash('#live=roomroomroom.<script>')).toBeNull()
  })
})

describe('identities', () => {
  it('makes a two-word name and a colour', () => {
    const me = randomIdentity(() => 0.5)
    expect(me.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
    expect(me.color).toMatch(/^#[0-9a-f]{6}$/)
    expect(randomIdentity(() => 0.9999).name.split(' ')).toHaveLength(2)
  })

  it('makes initials', () => {
    expect(initials('Quiet Heron')).toBe('QH')
    expect(initials('  ada ')).toBe('A')
    expect(initials('')).toBe('?')
  })
})

describe('distinctIdentity', () => {
  it('keeps a name and colour nobody else has', () => {
    expect(distinctIdentity({ name: 'Riya', color: '#2f7dd1' }, [{ name: 'Aarsh', color: '#d9480f' }])).toBeNull()
    expect(distinctIdentity({ name: 'Riya', color: '#2f7dd1' }, [])).toBeNull()
  })

  it('renames someone whose name is taken, ignoring case, and frees their colour', () => {
    const others = [{ name: 'Aarsh', color: '#d9480f' }]
    const fresh = distinctIdentity({ name: 'aarsh', color: '#d9480f' }, others)
    expect(fresh?.name).not.toMatch(/^aarsh$/i)
    expect(fresh?.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
    expect(fresh?.color).not.toBe('#d9480f')
    expect(PEER_COLORS).toContain(fresh?.color)
  })

  it('only changes the colour when just the colour clashes', () => {
    expect(distinctIdentity({ name: 'Riya', color: '#d9480f' }, [{ name: 'Aarsh', color: '#d9480f' }])).toEqual({ name: 'Riya', color: expect.not.stringMatching('#d9480f') })
  })
})

describe('parseRelays', () => {
  it('keeps ws and wss URLs, once each', () => {
    expect(parseRelays('wss://a.example\n ws://localhost:4444, https://nope.example wss://a.example')).toEqual(['wss://a.example', 'ws://localhost:4444'])
    expect(parseRelays('')).toEqual([])
  })
})

describe('parseTurn', () => {
  it('accepts turn: and turns: URLs only', () => {
    expect(parseTurn(' turn:turn.example.com:3478 ', ' ada ', ' secret ')).toEqual({ url: 'turn:turn.example.com:3478', username: 'ada', credential: 'secret' })
    expect(parseTurn('turns:turn.example.com:443', '', '')?.url).toBe('turns:turn.example.com:443')
    expect(parseTurn('stun:stun.example.com', 'a', 'b')).toBeNull()
    expect(parseTurn('', 'a', 'b')).toBeNull()
  })
})
