import { describe, expect, it } from 'vitest'
import { initials, liveHash, parseSignaling, randomIdentity, readLiveHash } from './link'

describe('live links', () => {
  it('round-trips a room and key through the hash', () => {
    const hash = `#${liveHash('Ab3_dEf-12345678', 'k3y_With-Dashes_0123456789')}`
    expect(readLiveHash(hash)).toEqual({ room: 'Ab3_dEf-12345678', key: 'k3y_With-Dashes_0123456789', signaling: ['wss://signaling.yjs.dev'] })
  })

  it('carries a non-default signalling server in the link', () => {
    const hash = liveHash('room12345678', 'key12345678', ['ws://localhost:4444', 'wss://sig.example'])
    expect(hash).toContain('&sig=')
    expect(readLiveHash(`#${hash}`)?.signaling).toEqual(['ws://localhost:4444', 'wss://sig.example'])
    expect(liveHash('room12345678', 'key12345678', ['wss://signaling.yjs.dev'])).not.toContain('sig=')
    expect(readLiveHash('#live=room12345678.key12345678&sig=%E0%A4%A')?.signaling).toEqual(['wss://signaling.yjs.dev'])
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

describe('parseSignaling', () => {
  it('keeps ws and wss URLs, once each', () => {
    expect(parseSignaling('wss://a.example\n ws://localhost:4444, https://nope.example wss://a.example')).toEqual(['wss://a.example', 'ws://localhost:4444'])
    expect(parseSignaling('')).toEqual([])
  })
})
