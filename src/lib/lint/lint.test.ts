import { describe, expect, it } from 'vitest'
import { parse } from '@/lib/convert/testing'
import { SAMPLE_DBML } from '@/lib/sample'
import { RULES, lintSchema } from '.'
import { restyle, styleOf } from './rules/naming'
import { reservedIn } from './rules/reservedWords'

const run = (rule: string, dbml: string) => lintSchema(parse(dbml), RULES.map((r) => r.id).filter((id) => id !== rule))
const where = (rule: string, dbml: string) => run(rule, dbml).map((p) => (p.column ? `${p.tableId}.${p.column}` : p.tableId))

describe('primary-key', () => {
  it('flags tables with no primary key, counting composite keys', () => {
    expect(
      where(
        'primary-key',
        `Table a { id int [pk] }
         Table b { x int }
         Table c { x int
           y int
           indexes { (x, y) [pk] } }`,
      ),
    ).toEqual(['b'])
  })
})

describe('fk-index', () => {
  const dbml = `Table users { id int [pk] }
    Table posts {
      id int [pk]
      author_id int [ref: > users.id]
      editor_id int [ref: > users.id]
      indexes { editor_id }
    }
    Table likes {
      user_id int [ref: > users.id]
      post_id int [ref: > posts.id]
      indexes { (user_id, post_id) [pk] }
    }
    Table profiles { user_id int [unique, ref: - users.id] }`

  it('flags foreign keys no index starts with', () => {
    // likes.user_id leads the primary key and profiles.user_id is unique, so both are covered
    expect(where('fk-index', dbml)).toEqual(['posts.author_id', 'likes.post_id'])
    expect(run('fk-index', dbml)[0].message).toContain('indexes { author_id }')
  })

  it('stays quiet for MySQL, which indexes foreign keys itself', () => {
    expect(where('fk-index', `Project p { database_type: 'MySQL' }\n${dbml}`)).toEqual([])
  })

  it('handles refs written in either direction and composite keys', () => {
    expect(
      where(
        'fk-index',
        `Table a { x int
           y int
           indexes { (x, y) [pk] } }
         Table b { id int [pk]
           ax int
           ay int }
         Ref: a.(x, y) < b.(ax, ay)`,
      ),
    ).toEqual(['b.ax'])
  })
})

describe('nullable-fk', () => {
  it('flags nullable keys on required relationships, but not optional ones', () => {
    expect(
      where(
        'nullable-fk',
        `Table users { id int [pk] }
         Table posts {
           id int [pk]
           author_id int [ref: > users.id]
           editor_id int [ref: >? users.id]
           owner_id int [not null, ref: > users.id]
         }`,
      ),
    ).toEqual(['posts.author_id'])
  })

  it('flags set null on a not null column', () => {
    const problems = run(
      'nullable-fk',
      `Table users { id int [pk] }
       Table posts { id int [pk]
         author_id int [not null] }
       Ref: posts.author_id > users.id [delete: set null]`,
    )
    expect(problems).toHaveLength(1)
    expect(problems[0].message).toMatch(/sets it to null/)
  })

  it('treats composite primary key columns as not null', () => {
    expect(
      where(
        'nullable-fk',
        `Table a { id int [pk] }
         Table b { a_id int [ref: > a.id]
           n int
           indexes { (a_id, n) [pk] } }`,
      ),
    ).toEqual([])
  })
})

describe('ref-types', () => {
  it('flags mismatched types but allows serial → integer and different lengths', () => {
    expect(
      where(
        'ref-types',
        `Table a { id serial [pk]
           code varchar(10) [unique] }
         Table b {
           a_id integer [ref: > a.id]
           a_code varchar(20) [ref: > a.code]
           big bigint [ref: > a.id]
           label text [ref: > a.code]
         }`,
      ),
    ).toEqual(['b.big', 'b.label'])
  })
})

describe('reserved-word', () => {
  it('flags reserved table and column names', () => {
    expect(where('reserved-word', `Table order { id int [pk]\n user int\n status text }`)).toEqual(['order', 'order.user'])
  })

  it('checks only the database the schema targets', () => {
    expect(reservedIn('key', null)).toEqual(['MySQL', 'SQL Server'])
    expect(reservedIn('key', 'PostgreSQL')).toEqual([])
    expect(reservedIn('Rank', 'MySQL')).toEqual(['MySQL'])
    expect(reservedIn('status', null)).toEqual([])
  })
})

describe('naming', () => {
  it('knows the styles', () => {
    expect(['user_id', 'userId', 'UserId', 'user-id', 'id', 'User', 'URL'].map(styleOf)).toEqual(['snake_case', 'camelCase', 'PascalCase', 'kebab-case', null, null, null])
    expect(restyle('userId', 'snake_case')).toBe('user_id')
    expect(restyle('created_at', 'camelCase')).toBe('createdAt')
  })

  it('flags the minority style, tables and columns separately', () => {
    expect(
      where(
        'naming',
        `Table UserAccount { id int [pk]
           first_name text
           last_name text
           createdAt timestamp }
         Table BlogPost { id int [pk]
           author_id int }
         Table order_items { id int [pk] }`,
      ),
    ).toEqual(['order_items', 'UserAccount.createdAt'])
  })

  it('says nothing when there is no clear majority', () => {
    expect(where('naming', `Table t { first_name text\n lastName text }`)).toEqual([])
  })
})

describe('wide-table', () => {
  it('flags tables with more than 40 columns', () => {
    const cols = (n: number) => Array.from({ length: n }, (_, i) => `c${i} int`).join('\n')
    expect(where('wide-table', `Table ok { ${cols(40)} }\nTable wide { ${cols(41)} }`)).toEqual(['wide'])
  })
})

describe('lintSchema', () => {
  it('skips disabled rules', () => {
    const model = parse(`Table t { x int }`)
    expect(lintSchema(model).map((p) => p.rule)).toContain('primary-key')
    expect(lintSchema(model, ['primary-key']).map((p) => p.rule)).not.toContain('primary-key')
  })

  it('gives the sample schema only real findings', () => {
    const problems = lintSchema(parse(SAMPLE_DBML))
    expect(new Set(problems.map((p) => p.rule))).toEqual(new Set(['fk-index', 'nullable-fk']))
    expect(problems.filter((p) => p.rule === 'nullable-fk').map((p) => `${p.tableId}.${p.column}`)).toEqual(['orders.shipping_address_id', 'books.publisher_id'])
  })
})
