import { PGlite } from '@electric-sql/pglite'
import ModelExporter from '@dbml-core-exporter'
import { describe, expect, it } from 'vitest'
import { compile } from '@/lib/dbml/compile'
import { parse } from '@/lib/convert/testing'
import { SAMPLE_DBML } from '@/lib/sample'
import { generateSeed, insertOrder } from '.'
import { sqlValue } from './generate'

const RICH = `Enum auth.role {
  admin
  member
}
Table auth.users {
  id uuid [pk]
  email varchar(120) [unique, not null]
  role auth.role [not null]
  first_name varchar(40)
  is_active boolean [not null]
  settings jsonb
  born date
}
Table profiles {
  user_id uuid [pk, ref: - auth.users.id]
  bio text
  avatar_url text
}
Table teams {
  id integer [pk, increment]
  name varchar(80) [not null]
  captain_id integer
}
Table players {
  id integer [pk, increment]
  team_id integer [not null, ref: > teams.id]
  mentor_id integer [ref: > players.id]
  rating decimal(3,1)
  code char(4) [unique]
}
Ref: teams.captain_id > players.id
Table memberships {
  user_id uuid [ref: > auth.users.id]
  team_id integer [ref: > teams.id]
  joined_at timestamp [not null]
  indexes {
    (user_id, team_id) [pk]
  }
}`

/** Export the schema's PostgreSQL DDL with the app's own exporter, create it in PGlite, then run the seed. */
async function runInPostgres(dbml: string, sql: string) {
  const { database } = compile(dbml)
  if (!database) throw new Error('fixture does not compile')
  const db = new PGlite()
  await db.exec(ModelExporter.export(database, 'postgres'))
  await db.exec(sql)
  return db
}

describe('insertOrder', () => {
  it('puts every parent before its children', () => {
    const model = parse(SAMPLE_DBML)
    const { order, deferred } = insertOrder(model)
    expect(deferred.size).toBe(0)
    for (const r of model.refs) expect(order.indexOf(r.target.tableId)).toBeLessThan(order.indexOf(r.source.tableId))
  })

  it('breaks a cycle at one key', () => {
    const { deferred } = insertOrder(parse(RICH))
    expect([...deferred]).toEqual(['teams>players'])
  })
})

describe('generateSeed', () => {
  it('is the same for the same seed and different for another', () => {
    const model = parse(SAMPLE_DBML)
    const a = generateSeed(model, { dialect: 'postgres', seed: 7 }).sql
    expect(generateSeed(model, { dialect: 'postgres', seed: 7 }).sql).toBe(a)
    expect(generateSeed(model, { dialect: 'postgres', seed: 8 }).sql).not.toBe(a)
  })

  it('respects row counts, enums and lengths', () => {
    const model = parse(SAMPLE_DBML)
    const { counts, sql, warnings } = generateSeed(model, { dialect: 'postgres', rows: { orders: 25, books: 3 }, defaultRows: 5 })
    expect(counts.orders).toBe(25)
    expect(counts.books).toBe(3)
    expect(counts.customers).toBe(5)
    expect(warnings).toEqual([])
    expect(sql).toMatch(/INSERT INTO "orders" \("id", "customer_id", "shipping_address_id", "status", "placed_at"\) VALUES/)
    // every order status is one of the enum's values
    const statuses = [...sql.matchAll(/^  \(\d+, \d+, (?:\d+|NULL), '([a-z]+)'/gm)].map((m) => m[1])
    expect(statuses).toHaveLength(25)
    expect(statuses.every((s) => ['pending', 'paid', 'shipped', 'cancelled'].includes(s))).toBe(true)
    // book_authors has a composite key over 3 books × 5 authors: at most 15 distinct pairs
    expect(counts.book_authors).toBe(5)
  })

  it('says when a table can’t get the rows it asked for', () => {
    const model = parse(RICH)
    const { counts, warnings } = generateSeed(model, { dialect: 'postgres', rows: { 'auth.users': 3, profiles: 10, teams: 0, players: 4 } })
    expect(counts.profiles).toBe(3)
    expect(counts.players).toBe(0)
    expect(warnings.join('\n')).toMatch(/profiles: made 3 of 10 rows, because each row needs a different row/)
    expect(warnings.join('\n')).toMatch(/players: made 0 of 4 rows, because it needs rows in teams first/)
  })

  it('formats values for each database', () => {
    expect(sqlValue("it's", 'postgres')).toBe("'it''s'")
    expect(sqlValue('a\\b', 'mysql')).toBe("'a\\\\b'")
    expect(sqlValue('Zoë', 'mssql')).toBe("N'Zoë'")
    expect(sqlValue(true, 'postgres')).toBe('TRUE')
    expect(sqlValue(true, 'sqlite')).toBe('1')
    expect(sqlValue({ date: new Date(Date.UTC(2024, 0, 2, 3, 4, 5)), kind: 'datetime' }, 'mysql')).toBe("'2024-01-02 03:04:05'")
    expect(sqlValue({ bytes: 'beef' }, 'postgres')).toBe("'\\xbeef'")
    expect(sqlValue(null, 'mssql')).toBe('NULL')
  })
})

// the real test: PostgreSQL accepts every row, foreign keys and unique constraints included
describe('seed data in PostgreSQL (PGlite)', () => {
  it('loads into the sample schema', async () => {
    const model = parse(SAMPLE_DBML)
    const { sql, counts } = generateSeed(model, { dialect: 'postgres', defaultRows: 20 })
    const db = await runInPostgres(SAMPLE_DBML, sql)
    for (const [table, n] of Object.entries(counts)) {
      const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}"`)
      expect(r.rows[0].n, table).toBe(n)
    }
    // the sequence moved past the explicit ids, so a normal insert still works
    await db.exec(`INSERT INTO customers (email, full_name) VALUES ('new@example.com', 'New Person')`)
    await db.close()
  }, 60_000)

  it('loads into a schema with uuids, enums, a cycle, a self reference and composite keys', async () => {
    const model = parse(RICH)
    const { sql, counts, warnings } = generateSeed(model, { dialect: 'postgres', defaultRows: 12, seed: 3 })
    expect(warnings).toEqual([])
    expect(sql).toContain('UPDATE "teams" SET "captain_id"')
    const db = await runInPostgres(RICH, sql)
    const n = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM teams WHERE captain_id IS NOT NULL')
    expect(n.rows[0].n).toBe(counts.teams)
    const m = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM memberships')
    expect(m.rows[0].n).toBe(counts.memberships)
    await db.close()
  }, 60_000)
})
