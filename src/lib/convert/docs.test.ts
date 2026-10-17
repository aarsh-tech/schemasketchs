import { describe, expect, it } from 'vitest'
import { anchor, cell, toMarkdown } from './markdown'
import { toMermaid } from './mermaid'
import { FIXTURES, parse } from './testing'

describe('toMermaid', () => {
  it('writes entities, keys and crow’s-foot relationships', () => {
    const out = toMermaid(
      parse(`Table users { id int [pk]
          email varchar(255) [unique, note: 'Login "name"'] }
        Table posts { id int [pk]
          author_id int [ref: > users.id]
          price decimal(10,2) }
        Table profiles { user_id int [unique, ref: - users.id] }`),
    )
    expect(out).toContain('    users {\n        int id PK\n        varchar(255) email UK "Login \'name\'"\n    }')
    expect(out).toContain('        int author_id FK')
    expect(out).toContain('        decimal price "decimal(10,2)"')
    expect(out).toContain('    users ||--|{ posts : "author_id"')
    expect(out).toContain('    users ||--|| profiles : "user_id"')
  })

  it('renames what Mermaid can’t read and labels it with the original', () => {
    const out = toMermaid(parse(`Table auth.users { "first name" "double precision" }\nTable "2fa" { id int }`))
    expect(out).toContain('auth_users["auth.users"] {')
    expect(out).toContain('double_precision first_name "first name"')
    expect(out).toContain('_2fa["2fa"] {')
  })

  it('lists enums in a comment', () => {
    expect(toMermaid(parse(`Enum role { admin\n member }\nTable t { r role }`))).toContain('%% role: admin, member')
  })

  // the strictest check: Mermaid's own parser, the one GitHub uses, accepts every fixture
  it('produces diagrams Mermaid parses', async () => {
    const { default: mermaid } = await import('mermaid')
    for (const f of FIXTURES) {
      const text = toMermaid(parse(f.dbml))
      await expect(mermaid.parse(text), f.name).resolves.toBeTruthy()
    }
  }, 60_000)
})

describe('toMarkdown', () => {
  it('helpers escape cells and make GitHub anchors', () => {
    expect(cell('a|b\nc')).toBe('a\\|b<br>c')
    expect(anchor('auth.users')).toBe('authusers')
    expect(anchor('order_items')).toBe('order_items')
  })

  it('documents every table, column and relationship', () => {
    const md = toMarkdown(parse(FIXTURES[0].dbml), { title: 'Bookshop' })
    expect(md).toMatch(/^# Bookshop\n\nData dictionary: 8 tables, 8 relationships, 1 enum, for PostgreSQL\./)
    expect(md).toContain('- [order_items](#order_items)')
    expect(md).toContain('```mermaid\nerDiagram')
    expect(md).toContain('## customers\n\nOne row per registered buyer\n\n| Column | Type | Key | Null | Default | Note |')
    expect(md).toContain('| `id` | `integer` | PK | not null | auto increment |  |')
    expect(md).toContain('| `status` | `order_status` (enum) |  | null | `\'pending\'` |  |')
    expect(md).toContain('| `order_id` | `integer` | PK, FK | not null |  |  |')
    expect(md).toContain('- `customer_id` → [customers](#customers).`id` (many to one)')
    expect(md).toContain('**Referenced by**\n\n- [addresses](#addresses).`customer_id`\n- [orders](#orders).`customer_id`')
    expect(md).toContain('### order_status\n\n`pending`, `paid`, `shipped`, `cancelled`')
  })

  it('can leave the diagram out', () => {
    expect(toMarkdown(parse('Table t { id int }'), { diagram: false })).not.toContain('mermaid')
  })
})
