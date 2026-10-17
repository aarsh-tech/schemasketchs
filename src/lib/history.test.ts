import { describe, expect, it } from 'vitest'
import { SAMPLE_DBML } from '@/lib/sample'
import { addVersion, countTables, describeDelta, needsSnapshot, tableDelta } from './history'
import type { Version } from './history'

let t = 0
const v = (over: Partial<Version> = {}): Version => ({
  id: `v${++t}`,
  createdAt: t * 1000,
  label: null,
  auto: true,
  source: `src ${t}`,
  positions: {},
  tableCount: 1,
  ...over,
})

describe('addVersion', () => {
  it('keeps versions newest first', () => {
    const a = v()
    const b = v()
    expect(addVersion([a], b).map((x) => x.id)).toEqual([b.id, a.id])
  })

  it('prunes the oldest automatic snapshots past the limit', () => {
    let list: Version[] = []
    for (let i = 0; i < 5; i++) list = addVersion(list, v(), 3)
    expect(list).toHaveLength(3)
    expect(list.every((x) => x.auto)).toBe(true)
    expect(list[0].createdAt).toBeGreaterThan(list[2].createdAt)
  })

  it('never prunes labelled versions, and they do not count towards the limit', () => {
    const keep = v({ auto: false, label: 'before refactor' })
    let list: Version[] = [keep]
    for (let i = 0; i < 6; i++) list = addVersion(list, v(), 2)
    expect(list).toContain(keep)
    expect(list.filter((x) => x.auto)).toHaveLength(2)
  })
})

describe('needsSnapshot', () => {
  it('skips empty text and text equal to the newest version', () => {
    const last = v({ source: 'Table a { id int }' })
    expect(needsSnapshot([], '  ')).toBe(false)
    expect(needsSnapshot([last], 'Table a { id int }')).toBe(false)
    expect(needsSnapshot([last], 'Table b { id int }')).toBe(true)
    expect(needsSnapshot([], 'Table b { id int }')).toBe(true)
  })
})

describe('table counts', () => {
  it('compares each version with the one before it', () => {
    const list = [v({ tableCount: 5 }), v({ tableCount: 3 }), v({ tableCount: 3 })]
    expect(tableDelta(list, 0)).toBe(2)
    expect(tableDelta(list, 1)).toBe(0)
    expect(tableDelta(list, 2)).toBeNull()
  })

  it('describes the change', () => {
    expect(describeDelta(null)).toBe('first version')
    expect(describeDelta(0)).toBe('same tables')
    expect(describeDelta(1)).toBe('+1 table')
    expect(describeDelta(-3)).toBe('−3 tables')
  })

  it('counts tables in text, ignoring comments', () => {
    expect(countTables(SAMPLE_DBML)).toBe(8)
    expect(countTables('// Table old {\n/* Table x { } */\nTable "a b" {\n  id int\n}\n')).toBe(1)
  })
})
