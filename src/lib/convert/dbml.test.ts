import { describe, expect, it } from 'vitest'
import { diffSchemas, isEmptyDiff } from '@/lib/diff'
import { SAMPLE_DBML } from '@/lib/sample'
import { toDbml } from './dbml'
import { parse } from './testing'

describe('toDbml', () => {
  it('prints the sample schema back to an equivalent schema', () => {
    const a = parse(SAMPLE_DBML)
    const b = parse(toDbml(a))
    expect(isEmptyDiff(diffSchemas(a, b))).toBe(true)
    expect(b.groups).toEqual(a.groups)
    expect(b.notes).toEqual(a.notes)
    expect(b.databaseType).toBe('PostgreSQL')
    expect(b.tables.map((t) => [t.name, t.note, t.headerColor])).toEqual(a.tables.map((t) => [t.name, t.note, t.headerColor]))
  })

  it('quotes awkward names and types, and keeps schemas, arrays, indexes and ref actions', () => {
    const src = `Project { database_type: 'PostgreSQL' }
Enum auth.role { admin
  "read only" }
Table auth.users {
  id uuid [pk, default: \`gen_random_uuid()\`]
  "display name" "double precision"
  tags text[]
  role auth.role [not null, default: 'admin', note: 'It\\'s the role']
  indexes {
    (role, tags) [unique, name: 'users_role_tags']
    \`lower(tags)\` [type: hash]
  }
}
Table posts {
  id integer [pk, increment]
  author_id uuid
}
Ref fk_author: posts.author_id > auth.users.id [delete: cascade, update: no action]
Ref: auth.users.id - posts.id`
    const a = parse(src)
    const b = parse(toDbml(a))
    expect(isEmptyDiff(diffSchemas(a, b))).toBe(true)
    expect(b.enums[0].values).toEqual(['admin', 'read only'])
    expect(b.tables[0].fields.map((f) => f.note)).toEqual(a.tables[0].fields.map((f) => f.note))
  })
})
