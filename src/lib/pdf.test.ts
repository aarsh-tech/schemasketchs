import { describe, expect, it } from 'vitest'
import { EMPTY_STACK, makeStep, record, redo, undo } from './layoutHistory'
import { imagePdf, pageLayout } from './pdf'

describe('imagePdf', () => {
  // the start and end markers of a JPEG are all a PDF reader needs to find it
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])
  const text = (b: Uint8Array) => new TextDecoder('latin1').decode(b)

  it('writes a well-formed single-page PDF with a correct cross-reference table', () => {
    const pdf = imagePdf({ jpeg, width: 1200, height: 800 }, 'Shop (v2)')
    const s = text(pdf)
    expect(s.startsWith('%PDF-1.4\n')).toBe(true)
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(s).toContain('/Filter /DCTDecode /Length 9')
    expect(s).toContain('/Title (Shop \\(v2\\))')
    // every xref entry points at the start of its object
    const startxref = Number(/startxref\n(\d+)/.exec(s)![1])
    const raw = new TextDecoder('latin1').decode(pdf.slice(startxref))
    const entries = [...raw.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]))
    expect(entries).toHaveLength(6)
    const bytes = new TextDecoder('latin1').decode(pdf)
    entries.forEach((offset, i) => expect(bytes.slice(offset, offset + 7)).toBe(`${i + 1} 0 obj`))
  })

  it('fits the image on a landscape or portrait A4 page', () => {
    const wide = pageLayout(2000, 1000)
    expect(wide.landscape).toBe(true)
    expect(wide.page.width).toBeCloseTo(841.89)
    expect(wide.image.width).toBeCloseTo(841.89 - 56)
    const tall = pageLayout(500, 1500)
    expect(tall.landscape).toBe(false)
    expect(tall.image.height).toBeCloseTo(841.89 - 56)
    expect(tall.image.x).toBeGreaterThan(28)
  })
})

describe('layout history', () => {
  const a = { x: 0, y: 0 }
  const b = { x: 100, y: 50 }

  it('keeps only nodes that moved', () => {
    expect(makeStep({ t1: a, t2: a }, { t1: b, t2: a })).toEqual({ before: { t1: a }, after: { t1: b } })
    expect(makeStep({ t1: a }, { t1: { ...a } })).toBeNull()
    // a node placed for the first time has nothing to go back to
    expect(makeStep({}, { t1: b })).toBeNull()
  })

  it('undoes and redoes in order, and a new move clears redo', () => {
    let stack = record(EMPTY_STACK, makeStep({ t: a }, { t: b })!)
    stack = record(stack, makeStep({ t: b }, { t: a })!)
    const u1 = undo(stack)!
    expect(u1.apply).toEqual({ t: b })
    const u2 = undo(u1.stack)!
    expect(u2.apply).toEqual({ t: a })
    expect(undo(u2.stack)).toBeNull()
    const r1 = redo(u2.stack)!
    expect(r1.apply).toEqual({ t: b })
    const fresh = record(r1.stack, makeStep({ t: b }, { t: { x: 9, y: 9 } })!)
    expect(redo(fresh)).toBeNull()
    expect(fresh.past).toHaveLength(2)
  })

  it('keeps at most 100 steps', () => {
    let stack = EMPTY_STACK
    for (let i = 0; i < 120; i++) stack = record(stack, { before: { t: { x: i, y: 0 } }, after: { t: { x: i + 1, y: 0 } } })
    expect(stack.past).toHaveLength(100)
    expect(stack.past[0].before.t.x).toBe(20)
  })
})
