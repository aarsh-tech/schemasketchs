import { describe, expect, it } from 'vitest'
import { SAMPLE_DBML } from '@/lib/sample'
import { EditError, applyEdit } from './edit'
import { toDbmlDefault, toDbmlType, uniqueName } from './values'
import type { ColumnSpec } from './edit'

const users = { name: 'users' }
const posts = { name: 'posts' }

const BASE = `// users of the app
Table users as U {
  id integer [pk, increment] // the id
  email varchar(255) [unique, not null]
  Note: 'People'
}

Table posts {
  id integer [pk]
  author_id integer [ref: > users.id]
  title varchar
  indexes {
    (author_id, id) [unique]
    title
  }
}

Ref fk_editor: posts.id - U.email [delete: cascade]
`

const spec = (over: Partial<ColumnSpec> = {}): ColumnSpec => ({
  name: 'title',
  type: 'varchar',
  pk: false,
  unique: false,
  notNull: false,
  defaultValue: null,
  ...over,
})

describe('add-table', () => {
  it('appends a table with an id column', () => {
    const out = applyEdit(BASE, { type: 'add-table', name: 'tags' })
    expect(out).toBe(`${BASE}\nTable tags {\n  id integer [pk, increment]\n}\n`)
  })

  it('quotes names DBML needs quoted and handles schemas', () => {
    const out = applyEdit(BASE, { type: 'add-table', name: 'audit log', schema: 'ops' })
    expect(out).toContain('Table ops."audit log" {')
  })

  it('refuses a name that is taken', () => {
    expect(() => applyEdit(BASE, { type: 'add-table', name: 'Users' })).toThrow(EditError)
  })

  it('works on an empty document', () => {
    expect(applyEdit('', { type: 'add-table', name: 't' })).toBe('Table t {\n  id integer [pk, increment]\n}\n')
  })
})

describe('rename-table', () => {
  it('renames the table and every reference, keeping comments', () => {
    const out = applyEdit(BASE, { type: 'rename-table', table: users, name: 'members' })
    expect(out).toContain('// users of the app\nTable members as U {')
    expect(out).toContain('[ref: > members.id]')
    expect(out).toContain('// the id')
    // the alias still points at the renamed table
    expect(out).toContain('posts.id - U.email')
  })

  it('refuses to collide with another table', () => {
    expect(() => applyEdit(BASE, { type: 'rename-table', table: users, name: 'posts' })).toThrow(/already a table/)
  })

  it('is a no-op when the name is unchanged', () => {
    expect(applyEdit(BASE, { type: 'rename-table', table: users, name: 'users' })).toBe(BASE)
  })
})

describe('delete-table', () => {
  it('removes the table and the refs that point at it', () => {
    const out = applyEdit(BASE, { type: 'delete-table', table: users })
    expect(out).not.toContain('Table users')
    expect(out).toContain('  author_id integer\n')
    expect(out).not.toContain('Ref fk_editor')
    expect(out).not.toMatch(/\n\n\n/)
  })

  it('removes the table from table groups', () => {
    const src = `${BASE}\nTableGroup g {\n  users\n  posts\n}\n`
    const out = applyEdit(src, { type: 'delete-table', table: posts })
    expect(out).toContain('TableGroup g {\n  users\n}')
    expect(out).not.toContain('fk_editor')
  })

  it('takes the comment written directly above the table, and only that', () => {
    const out = applyEdit(SAMPLE_DBML, { type: 'delete-table', table: { name: 'book_authors' } })
    expect(out).not.toContain('many-to-many through a join table')
    expect(out).toContain('// A small online bookshop.')
    const kept = applyEdit(BASE, { type: 'delete-table', table: posts })
    expect(kept.startsWith('// users of the app\nTable users')).toBe(true)
    expect(kept.endsWith("  Note: 'People'\n}\n")).toBe(true)
  })

  it('works on the sample schema', () => {
    const out = applyEdit(SAMPLE_DBML, { type: 'delete-table', table: { name: 'books' } })
    expect(out).not.toMatch(/books\./)
    expect(out).not.toMatch(/^\s*books\s*$/m)
    expect(out).toContain('Table book_authors')
  })
})

describe('set-header-color', () => {
  it('adds, changes and removes the colour', () => {
    const added = applyEdit(BASE, { type: 'set-header-color', table: posts, color: '#3B6EA5' })
    expect(added).toContain('Table posts [headercolor: #3B6EA5] {')
    const changed = applyEdit(added, { type: 'set-header-color', table: posts, color: '#123' })
    expect(changed).toContain('Table posts [headercolor: #123] {')
    expect(applyEdit(changed, { type: 'set-header-color', table: posts, color: null })).toBe(BASE)
  })

  it('rejects colours that are not hex', () => {
    expect(() => applyEdit(BASE, { type: 'set-header-color', table: posts, color: 'red' })).toThrow(EditError)
  })
})

describe('add-column', () => {
  it('adds a line after the last column with the same indentation', () => {
    const out = applyEdit(BASE, { type: 'add-column', table: users, column: spec({ name: 'age', type: 'int', notNull: true, defaultValue: '0' }) })
    expect(out).toContain("  email varchar(255) [unique, not null]\n  age int [not null, default: 0]\n  Note: 'People'")
  })

  it('goes below a trailing comment', () => {
    const src = 'Table t {\n    id int // first\n}\n'
    expect(applyEdit(src, { type: 'add-column', table: { name: 't' }, column: spec({ name: 'b', type: 'text' }) })).toBe(
      'Table t {\n    id int // first\n    b text\n}\n',
    )
  })

  it('quotes types with spaces and names that need it', () => {
    const out = applyEdit(BASE, { type: 'add-column', table: posts, column: spec({ name: 'view count', type: 'double precision' }) })
    expect(out).toContain('"view count" "double precision"')
  })

  it('refuses duplicates and blank names', () => {
    expect(() => applyEdit(BASE, { type: 'add-column', table: posts, column: spec() })).toThrow(/already has a column/)
    expect(() => applyEdit(BASE, { type: 'add-column', table: posts, column: spec({ name: ' ' }) })).toThrow(EditError)
  })
})

describe('update-column', () => {
  it('toggles flags without touching other settings', () => {
    const out = applyEdit(BASE, { type: 'update-column', table: users, column: 'id', patch: spec({ name: 'id', type: 'integer', pk: false, notNull: true }) })
    expect(out).toContain('  id integer [increment, not null] // the id')
  })

  it('adds a settings list when there is none, and removes it when emptied', () => {
    const on = applyEdit(BASE, { type: 'update-column', table: posts, column: 'title', patch: spec({ unique: true, defaultValue: "'x'" }) })
    expect(on).toContain("  title varchar [unique, default: 'x']\n")
    expect(applyEdit(on, { type: 'update-column', table: posts, column: 'title', patch: spec() })).toBe(BASE)
  })

  it('changes a default in place', () => {
    const src = "Table t {\n  s text [not null, default: 'a', note: 'n']\n}\n"
    const out = applyEdit(src, { type: 'update-column', table: { name: 't' }, column: 's', patch: spec({ name: 's', type: 'text', notNull: true, defaultValue: '`now()`' }) })
    expect(out).toBe("Table t {\n  s text [not null, default: `now()`, note: 'n']\n}\n")
  })

  it('leaves fields out of the patch exactly as written', () => {
    const src = "Table t {\n  s text [primary key, default: 'it\\'s', note: 'n']\n}\n"
    const out = applyEdit(src, { type: 'update-column', table: { name: 't' }, column: 's', patch: { notNull: true } })
    expect(out).toBe("Table t {\n  s text [primary key, default: 'it\\'s', note: 'n', not null]\n}\n")
    expect(applyEdit(src, { type: 'update-column', table: { name: 't' }, column: 's', patch: { type: 'TEXT' } })).toBe(src)
  })

  it('changes the type', () => {
    const out = applyEdit(BASE, { type: 'update-column', table: posts, column: 'title', patch: spec({ type: 'varchar(120)' }) })
    expect(out).toContain('  title varchar(120)\n')
  })

  it('renames the column everywhere it is used', () => {
    const out = applyEdit(BASE, { type: 'update-column', table: users, column: 'id', patch: spec({ name: 'user_id', type: 'integer', pk: true }) })
    expect(out).toContain('  user_id integer [pk, increment] // the id')
    expect(out).toContain('[ref: > users.user_id]')

    const renamed = applyEdit(BASE, { type: 'update-column', table: posts, column: 'author_id', patch: spec({ name: 'writer_id', type: 'integer' }) })
    expect(renamed).toContain('(writer_id, id) [unique]')
    expect(renamed).toContain('  writer_id integer [ref: > users.id]')
  })

  it('reports a clash with another column', () => {
    expect(() => applyEdit(BASE, { type: 'update-column', table: posts, column: 'title', patch: spec({ name: 'id' }) })).toThrow(/already has a column/)
  })
})

describe('delete-column', () => {
  it('removes the column, its index entries and refs that use it', () => {
    const out = applyEdit(BASE, { type: 'delete-column', table: posts, column: 'author_id' })
    expect(out).not.toContain('author_id')
    expect(out).toContain('  indexes {\n    title\n  }')
  })

  it('removes an indexes block that ends up empty', () => {
    const src = 'Table t {\n  a int\n  b int\n  indexes {\n    b\n  }\n}\n'
    expect(applyEdit(src, { type: 'delete-column', table: { name: 't' }, column: 'b' })).toBe('Table t {\n  a int\n}\n')
  })

  it('refuses to delete the last column', () => {
    expect(() => applyEdit('Table t {\n  a int\n}\n', { type: 'delete-column', table: { name: 't' }, column: 'a' })).toThrow(/only column/)
  })
})

describe('add-ref', () => {
  it('appends a Ref line', () => {
    const out = applyEdit(BASE, { type: 'add-ref', from: { table: posts, column: 'title' }, to: { table: users, column: 'email' }, op: '>' })
    expect(out).toBe(`${BASE}Ref: posts.title > users.email\n`)
  })

  it('separates the first ref from a table with a blank line', () => {
    const src = 'Table a {\n  id int\n}\nTable b {\n  a_id int\n}\n'
    expect(applyEdit(src, { type: 'add-ref', from: { table: { name: 'b' }, column: 'a_id' }, to: { table: { name: 'a' }, column: 'id' }, op: '-' })).toBe(
      `${src}\nRef: b.a_id - a.id\n`,
    )
  })

  it('reports a duplicate relationship in plain words', () => {
    expect(() =>
      applyEdit(BASE, { type: 'add-ref', from: { table: posts, column: 'author_id' }, to: { table: users, column: 'id' }, op: '>' }),
    ).toThrow('Those columns are already related.')
  })
})

describe('delete-ref', () => {
  it('removes an inline ref setting', () => {
    const out = applyEdit(BASE, {
      type: 'delete-ref',
      endpoints: [
        { table: users, fields: ['id'] },
        { table: posts, fields: ['author_id'] },
      ],
    })
    expect(out).toContain('  author_id integer\n')
  })

  it('removes a standalone Ref written with an alias', () => {
    const out = applyEdit(BASE, {
      type: 'delete-ref',
      endpoints: [
        { table: posts, fields: ['id'] },
        { table: users, fields: ['email'] },
      ],
    })
    expect(out).not.toContain('fk_editor')
    expect(out.endsWith('}\n')).toBe(true)
  })

  it('removes a Ref block', () => {
    const src = 'Table a {\n  id int\n  x int\n  y int\n}\n\nRef {\n  a.x > a.id\n}\n\nRef {\n  a.y > a.id\n}\n'
    const a = { name: 'a' }
    const out = applyEdit(src, { type: 'delete-ref', endpoints: [{ table: a, fields: ['x'] }, { table: a, fields: ['id'] }] })
    expect(out).toBe('Table a {\n  id int\n  x int\n  y int\n}\n\nRef {\n  a.y > a.id\n}\n')
  })

  it('handles schema-qualified composite refs', () => {
    const src = 'Table s.a {\n  x int\n  y int\n}\nTable b {\n  x int\n  y int\n}\nRef: b.(x, y) > s.a.(x, y)\n'
    const out = applyEdit(src, { type: 'delete-ref', endpoints: [{ table: { schema: 's', name: 'a' }, fields: ['x', 'y'] }, { table: { name: 'b' }, fields: ['x', 'y'] }] })
    expect(out).not.toContain('Ref')
  })

  it('says so when the relationship is gone', () => {
    expect(() => applyEdit(BASE, { type: 'delete-ref', endpoints: [{ table: users, fields: ['email'] }, { table: posts, fields: ['title'] }] })).toThrow(EditError)
  })
})

describe('guards', () => {
  it('refuses to edit a schema with errors', () => {
    expect(() => applyEdit('Table {', { type: 'add-table', name: 'x' })).toThrow(/Fix the underlined line/)
  })

  it('names the missing table', () => {
    expect(() => applyEdit(BASE, { type: 'delete-table', table: { name: 'nope' } })).toThrow('Couldn’t find the table nope in the code.')
  })
})

describe('input helpers', () => {
  it('turns typed defaults into DBML values', () => {
    expect(toDbmlDefault('')).toBeNull()
    expect(toDbmlDefault('42')).toBe('42')
    expect(toDbmlDefault('-1.5')).toBe('-1.5')
    expect(toDbmlDefault('TRUE')).toBe('TRUE')
    expect(toDbmlDefault("'x'")).toBe("'x'")
    expect(toDbmlDefault('`now()`')).toBe('`now()`')
    expect(toDbmlDefault('now()')).toBe('`now()`')
    expect(toDbmlDefault('pending')).toBe("'pending'")
    expect(toDbmlDefault("it's")).toBe("'it\\'s'")
    expect(toDbmlDefault('"quoted"')).toBe("'quoted'")
  })

  it('quotes multi-word types only', () => {
    expect(toDbmlType('decimal(10, 2)')).toBe('decimal(10, 2)')
    expect(toDbmlType('double precision')).toBe('"double precision"')
    expect(toDbmlType(' int ')).toBe('int')
  })

  it('finds a free name', () => {
    expect(uniqueName('new_table', ['users'])).toBe('new_table')
    expect(uniqueName('new_table', ['new_table', 'New_Table_2'])).toBe('new_table_3')
  })
})
