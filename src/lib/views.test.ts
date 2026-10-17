import { describe, expect, it } from 'vitest'
import { parse } from '@/lib/convert/testing'
import { SAMPLE_DBML } from '@/lib/sample'
import { parseProjectFile, toProjectFile } from '@/lib/files'
import { cleanViews, neighbours, renameInViews, viewModel } from './views'
import type { SchemaView } from './views'

const model = parse(SAMPLE_DBML)

describe('viewModel', () => {
  it('keeps the view’s tables, the relationships between them and their groups', () => {
    const m = viewModel(model, ['books', 'authors', 'book_authors', 'nowhere'])
    expect(m.tables.map((t) => t.id)).toEqual(['books', 'authors', 'book_authors'])
    expect(m.refs.map((r) => `${r.source.tableId}>${r.target.tableId}`).sort()).toEqual(['book_authors>authors', 'book_authors>books'])
    expect(m.groups).toEqual([expect.objectContaining({ name: 'catalogue', tableIds: ['books', 'authors', 'book_authors'] })])
    expect(m.notes).toEqual([])
    expect(m.enums).toBe(model.enums)
  })

  it('drops groups with no table in the view', () => {
    expect(viewModel(model, ['customers']).groups).toEqual([])
  })
})

describe('neighbours', () => {
  it('lists tables one relationship away, in schema order', () => {
    expect(neighbours(model, ['orders'])).toEqual(['customers', 'addresses', 'order_items'])
    expect(neighbours(model, ['orders', 'customers', 'addresses', 'order_items'])).toEqual(['books'])
  })
})

describe('renameInViews', () => {
  const views: SchemaView[] = [
    { id: 'a', name: 'A', tableIds: ['users', 'posts'], positions: { users: { x: 1, y: 2 } } },
    { id: 'b', name: 'B', tableIds: ['posts'], positions: {} },
  ]
  it('follows a renamed table and keeps its position', () => {
    const next = renameInViews(views, 'users', 'accounts')
    expect(next[0]).toEqual({ id: 'a', name: 'A', tableIds: ['accounts', 'posts'], positions: { accounts: { x: 1, y: 2 } } })
    expect(next[1]).toBe(views[1])
  })
  it('returns the same array when nothing changes', () => {
    expect(renameInViews(views, 'nobody', 'x')).toBe(views)
  })
})

describe('saving views', () => {
  it('cleans what comes from a file or link', () => {
    expect(
      cleanViews([
        { id: 'x', name: 'Auth', tableIds: ['users', 'users', 3], positions: { users: { x: 1.4, y: 'no' }, posts: { x: 2.6, y: 3 } } },
        { name: 'No id', tableIds: [] },
        { id: 'x', name: 'Same id', tableIds: [] },
        { name: 5 },
        'junk',
      ]),
    ).toEqual([
      { id: 'x', name: 'Auth', tableIds: ['users'], positions: { posts: { x: 3, y: 3 } } },
      { id: 'view2', name: 'No id', tableIds: [], positions: {} },
      { id: 'x_', name: 'Same id', tableIds: [], positions: {} },
    ])
    expect(cleanViews(undefined)).toEqual([])
  })

  it('round-trips through a project file, and older files load without views', () => {
    const views: SchemaView[] = [{ id: 'v1', name: 'Catalogue', tableIds: ['books'], positions: { books: { x: 10, y: 20 } } }]
    const file = parseProjectFile(JSON.stringify(toProjectFile({ name: 'Shop', source: 'Table books { id int }', positions: {}, views })))
    expect(file?.views).toEqual(views)
    expect(parseProjectFile(JSON.stringify({ app: 'schemasketch', version: 1, name: 'Old', source: '', positions: {} }))?.views).toEqual([])
  })
})
