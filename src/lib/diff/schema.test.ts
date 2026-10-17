import { describe, expect, it } from 'vitest'
import { parseModel } from '@/lib/dbml/compile'
import { SAMPLE_DBML } from '@/lib/sample'
import { diffSchemas, invertDiff, isEmptyDiff, tableSimilarity } from './schema'
import { summarize } from './summary'

const parse = (source: string) => {
  const r = parseModel(source)
  if (!r.model) throw new Error(r.diagnostics.map((d) => `${d.line}: ${d.message}`).join('\n'))
  return r.model
}

const USERS = `Table users {
  id integer [pk, increment]
  email varchar(255) [unique, not null]
  name varchar(80)
  created_at timestamp [default: \`now()\`]
}`

const POSTS = `Table posts {
  id integer [pk]
  author_id integer [ref: > users.id]
  title varchar(200) [not null]
}`

describe('diffSchemas', () => {
  it('finds nothing between identical schemas', () => {
    const d = diffSchemas(parse(SAMPLE_DBML), parse(SAMPLE_DBML))
    expect(isEmptyDiff(d)).toBe(true)
    expect(summarize(d)).toEqual([])
  })

  it('ignores formatting, comments and type case', () => {
    const a = parse(USERS)
    const b = parse(`// people
Table users {
  id   integer [increment, pk]
  email VARCHAR(255) [not null, unique]
  name varchar(80)
  created_at timestamp [default: \`now()\`]
}`)
    expect(isEmptyDiff(diffSchemas(a, b))).toBe(true)
  })

  it('finds added and removed tables', () => {
    const d = diffSchemas(parse(USERS), parse(`${POSTS}\n\nTable users { id integer [pk] }`))
    expect(d.addedTables.map((t) => t.id)).toEqual(['posts'])
    expect(d.addedRefs).toHaveLength(1)
    const back = diffSchemas(parse(`${USERS}\n${POSTS}`), parse(USERS))
    expect(back.removedTables.map((t) => t.id)).toEqual(['posts'])
    expect(back.removedRefs).toHaveLength(1)
  })

  it('treats a table with the same columns under a new name as a rename', () => {
    const a = parse(`${USERS}\n${POSTS}`)
    const b = parse(`${USERS.replace('Table users', 'Table members')}\n${POSTS.replace('users.id', 'members.id')}`)
    const d = diffSchemas(a, b)
    expect(d.addedTables).toEqual([])
    expect(d.removedTables).toEqual([])
    expect(d.changedTables).toHaveLength(1)
    expect(d.changedTables[0]).toMatchObject({ renamed: true, from: { id: 'users' }, to: { id: 'members' } })
    // the relationship moved with the table, so it isn't dropped and re-added
    expect(d.addedRefs).toEqual([])
    expect(d.removedRefs).toEqual([])
  })

  it('keeps column changes on a renamed table', () => {
    const d = diffSchemas(parse(USERS), parse(USERS.replace('Table users', 'Table people').replace('  name varchar(80)\n', '  name text\n')))
    expect(d.changedTables[0].renamed).toBe(true)
    expect(d.changedTables[0].changedColumns.map((c) => [c.to.name, c.attrs])).toEqual([['name', ['type']]])
  })

  it('can turn rename detection off', () => {
    const d = diffSchemas(parse(USERS), parse(USERS.replace('Table users', 'Table members')), { detectRenames: false })
    expect(d.addedTables.map((t) => t.id)).toEqual(['members'])
    expect(d.removedTables.map((t) => t.id)).toEqual(['users'])
  })

  it('does not pair tables that only share a column or two', () => {
    const d = diffSchemas(parse(USERS), parse('Table invoices {\n  id integer [pk, increment]\n  total decimal(10,2)\n  paid_at timestamp\n  note text\n}'))
    expect(d.changedTables).toEqual([])
    expect(d.removedTables).toHaveLength(1)
    expect(d.addedTables).toHaveLength(1)
  })

  it('pairs each removed table with its closest match', () => {
    const a = parse('Table a { id int\n x int\n y int }\nTable b { id int\n p text\n q text }')
    const b = parse('Table a2 { id int\n x int\n y int\n z int }\nTable b2 { id int\n p text\n q text }')
    const pairs = diffSchemas(a, b).changedTables.map((c) => `${c.from.id}->${c.to.id}`)
    expect(pairs.sort()).toEqual(['a->a2', 'b->b2'])
  })

  it('finds added, removed and changed columns', () => {
    const b = parse(`Table users {
  id integer [pk, increment]
  email varchar(320) [not null]
  name varchar(80) [not null, default: 'Anon']
  bio text
}`)
    const c = diffSchemas(parse(USERS), b).changedTables[0]
    expect(c.addedColumns.map((f) => f.name)).toEqual(['bio'])
    expect(c.removedColumns.map((f) => f.name)).toEqual(['created_at'])
    expect(c.changedColumns.map((x) => [x.to.name, x.attrs])).toEqual([
      ['email', ['type', 'unique']],
      ['name', ['notNull', 'default']],
    ])
  })

  it('notices auto-increment changes', () => {
    const c = diffSchemas(parse(USERS), parse(USERS.replace('[pk, increment]', '[pk]'))).changedTables[0]
    expect(c.changedColumns[0].attrs).toEqual(['increment'])
  })

  it('tracks primary keys from column flags and composite indexes', () => {
    const a = parse('Table t {\n  a int [pk]\n  b int\n}')
    const b = parse('Table t {\n  a int\n  b int\n  indexes {\n    (a, b) [pk]\n  }\n}')
    const c = diffSchemas(a, b).changedTables[0]
    expect(c.primaryKey).toEqual({ from: ['a'], to: ['a', 'b'] })
    // a pk index is a primary key, not an index
    expect(c.addedIndexes).toEqual([])
  })

  it('finds added and removed indexes', () => {
    const a = parse('Table t {\n  a int\n  b int\n  indexes {\n    a\n    (a, b) [unique]\n  }\n}')
    const b = parse('Table t {\n  a int\n  b int\n  indexes {\n    (a, b) [unique]\n    b [name: "t_b", type: hash]\n    `lower(a)`\n  }\n}')
    const c = diffSchemas(a, b).changedTables[0]
    expect(c.removedIndexes.map((i) => i.columns)).toEqual([['a']])
    expect(c.addedIndexes).toEqual([
      { name: 't_b', columns: ['b'], unique: false, pk: false, type: 'hash' },
      { name: null, columns: ['`lower(a)`'], unique: false, pk: false, type: null },
    ])
  })

  it('finds enum changes', () => {
    const a = parse('Enum status {\n  draft\n  live\n}\nEnum old_thing {\n  x\n}')
    const b = parse('Enum status {\n  draft\n  live\n  archived\n}\nEnum mood {\n  happy\n}')
    const d = diffSchemas(a, b)
    expect(d.addedEnums.map((e) => e.id)).toEqual(['mood'])
    expect(d.removedEnums.map((e) => e.id)).toEqual(['old_thing'])
    expect(d.changedEnums).toMatchObject([{ addedValues: ['archived'], removedValues: [] }])
  })

  it('sees a changed delete rule as a replaced relationship', () => {
    const a = parse(`${USERS}\n${POSTS}`)
    const b = parse(`${USERS}\n${POSTS.replace('[ref: > users.id]', '')}\nRef: posts.author_id > users.id [delete: cascade]`)
    const d = diffSchemas(a, b)
    expect(d.removedRefs).toHaveLength(1)
    expect(d.addedRefs).toMatchObject([{ onDelete: 'cascade' }])
  })

  it('keeps tables in other schemas apart', () => {
    const d = diffSchemas(parse('Table users { id int }'), parse('Table users { id int }\nTable auth.users { id int }'))
    expect(d.addedTables.map((t) => t.id)).toEqual(['auth.users'])
  })
})

describe('invertDiff', () => {
  it('is its own inverse', () => {
    const d = diffSchemas(parse(`${USERS}\n${POSTS}`), parse(SAMPLE_DBML))
    expect(invertDiff(invertDiff(d))).toEqual(d)
  })

  it('matches diffing the other way round', () => {
    const a = parse(`${USERS}\nEnum s {\n  a\n}`)
    const b = parse(`${USERS.replace('  name varchar(80)\n', '  name text [not null]\n  age int\n')}\n${POSTS}\nEnum s {\n  a\n  b\n}`)
    expect(invertDiff(diffSchemas(a, b))).toEqual(diffSchemas(b, a))
  })
})

describe('tableSimilarity', () => {
  it('is 1 for the same columns and 0 for none in common', () => {
    const [u] = parse(USERS).tables
    expect(tableSimilarity(u, u)).toBe(1)
    expect(tableSimilarity(u, parse('Table x { other text }').tables[0])).toBe(0)
  })
})

describe('summarize', () => {
  it('flags data loss and risky changes', () => {
    const a = parse(`${USERS}\n${POSTS}`)
    const b = parse(USERS.replace('  name varchar(80)\n', '  name varchar(40)\n').replace('  created_at', '  age int [not null]\n  created_at'))
    const items = summarize(diffSchemas(a, b))
    expect(items).toContainEqual(expect.objectContaining({ kind: 'remove', subject: 'posts', risk: 'destructive' }))
    expect(items).toContainEqual(expect.objectContaining({ kind: 'change', subject: 'users.name', text: 'type varchar(80) → varchar(40)', risk: 'caution' }))
    expect(items).toContainEqual(expect.objectContaining({ kind: 'add', subject: 'users.age', risk: 'caution' }))
    expect(items).toContainEqual(expect.objectContaining({ kind: 'remove', subject: 'posts.author_id → users.id', risk: null }))
  })

  it('lists renames first and describes column changes', () => {
    const a = parse(USERS)
    const b = parse(USERS.replace('Table users', 'Table people').replace("timestamp [default: `now()`]", 'timestamp'))
    expect(summarize(diffSchemas(a, b))).toEqual([
      { kind: 'rename', subject: 'users', text: 'renamed to people', risk: null },
      { kind: 'change', subject: 'people.created_at', text: 'default `now()` removed', risk: null, note: undefined },
    ])
  })
})
