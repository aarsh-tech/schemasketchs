import { describe, expect, it } from 'vitest'
import { parse } from '@/lib/convert/testing'
import { SAMPLE_DBML } from '@/lib/sample'
import { fuzzyScore, rank, tablesWithin } from './search'

describe('fuzzyScore', () => {
  it('ranks exact, prefix, substring, then scattered matches', () => {
    const exact = fuzzyScore('orders', 'orders')
    const prefix = fuzzyScore('ord', 'orders')
    const inside = fuzzyScore('ders', 'orders')
    const scattered = fuzzyScore('oi', 'order_items')
    expect(exact).toBeGreaterThan(prefix)
    expect(prefix).toBeGreaterThan(inside)
    expect(inside).toBeGreaterThan(scattered)
    expect(scattered).toBeGreaterThan(0)
  })

  it('prefers word starts and camelCase humps', () => {
    expect(fuzzyScore('oi', 'order_items')).toBeGreaterThan(fuzzyScore('oi', 'notional'))
    expect(fuzzyScore('ui', 'userId')).toBeGreaterThan(fuzzyScore('ui', 'unit'))
  })

  it('rejects characters out of order', () => {
    expect(fuzzyScore('xo', 'orders')).toBe(-1)
    expect(fuzzyScore('sro', 'orders')).toBe(-1)
  })

  it('ignores case and spaces in the query', () => {
    expect(fuzzyScore('ORD', 'orders')).toBeGreaterThan(0)
    expect(fuzzyScore('export png', 'Export PNG image')).toBeGreaterThan(0)
  })
})

describe('rank', () => {
  const items = [{ label: 'Export PNG image' }, { label: 'orders' }, { label: 'order_items' }, { label: 'Fit diagram to screen', keywords: 'zoom view all' }]
  it('sorts by score and drops non-matches', () => {
    expect(rank('ord', items).map((i) => i.label)).toEqual(['orders', 'order_items'])
  })
  it('matches keywords, below a match on the label', () => {
    expect(rank('zoom', items).map((i) => i.label)).toEqual(['Fit diagram to screen'])
  })
  it('returns everything for an empty query, up to the limit', () => {
    expect(rank('', items, 2)).toEqual(items.slice(0, 2))
  })
})

describe('tablesWithin', () => {
  const model = parse(SAMPLE_DBML)
  it('walks relationships in both directions up to the depth', () => {
    expect(Object.fromEntries(tablesWithin(model, 'orders', 1))).toEqual({ orders: 0, customers: 1, addresses: 1, order_items: 1 })
    const two = tablesWithin(model, 'orders', 2)
    expect(two.get('books')).toBe(2)
    expect(two.has('publishers')).toBe(false)
    expect(tablesWithin(model, 'orders', 3).get('publishers')).toBe(3)
  })
  it('handles a table with no relationships', () => {
    expect([...tablesWithin(model, 'nobody', 3)]).toEqual([['nobody', 0]])
  })
})
