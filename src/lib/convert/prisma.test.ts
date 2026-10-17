import { describe, expect, it } from 'vitest'
import { diffSchemas, summarize } from '@/lib/diff'
import { SAMPLE_DBML } from '@/lib/sample'
import { parse } from './testing'
import { toDbml } from './dbml'
import { fromPrisma, toPrisma } from './prisma'

/** DBML → Prisma → DBML, checked with the migration diff. */
function roundTrip(dbml: string, provider?: 'postgresql' | 'mysql' | 'sqlite') {
  const a = parse(dbml)
  const prisma = toPrisma(a, { provider })
  const { model, warnings } = fromPrisma(prisma)
  const b = parse(toDbml(model))
  return { a, b, prisma, warnings, diff: summarize(diffSchemas(a, b)) }
}

describe('Prisma export', () => {
  it('writes the sample schema the way prisma db pull would', () => {
    const out = toPrisma(parse(SAMPLE_DBML))
    expect(out).toContain('provider = "postgresql"')
    expect(out).toContain('enum order_status {')
    expect(out).toMatch(/model customers \{\n {2}id\s+Int\s+@id @default\(autoincrement\(\)\)/)
    expect(out).toMatch(/email\s+String\s+@unique @db\.VarChar\(255\)/)
    expect(out).toMatch(/status\s+order_status\?\s+@default\(pending\)/)
    expect(out).toMatch(/created_at\s+DateTime\?\s+@default\(now\(\)\)/)
    expect(out).toMatch(/customer\s+customers\s+@relation\(fields: \[customer_id\], references: \[id\]\)/)
    expect(out).toMatch(/orders\s+orders\[\]/)
    expect(out).toContain('@@id([order_id, book_id])')
    expect(out).toContain('/// One row per registered buyer')
  })

  it('maps names Prisma can’t use and names relations that need it', () => {
    const out = toPrisma(
      parse(`Table "user accounts" {
  id integer [pk]
  "first name" text
  manager_id integer [ref: > "user accounts".id]
}
Table moves {
  id integer [pk]
  from_id integer [ref: > "user accounts".id]
  to_id integer [ref: > "user accounts".id]
}`),
    )
    expect(out).toContain('model user_accounts {')
    expect(out).toContain('@@map("user accounts")')
    expect(out).toMatch(/first_name\s+String\?\s+@map\("first name"\)/)
    expect(out).toContain('@relation("user accounts_manager_id", fields: [manager_id], references: [id])')
    expect(out).toContain('@relation("moves_from_id", fields: [from_id], references: [id])')
    expect(out).toMatch(/moves_from\s+moves\[\]\s+@relation\("moves_from_id"\)/)
  })

  it('marks tables without a key as ignored and leaves expression indexes as comments', () => {
    const out = toPrisma(parse("Table log {\n  msg text\n  indexes {\n    `lower(msg)`\n  }\n}"))
    expect(out).toContain('@@ignore')
    expect(out).toContain("// Prisma can't express an index on an expression")
  })

  it('uses MySQL native types for a MySQL schema', () => {
    const out = toPrisma(parse(`Project { database_type: 'MySQL' }\nTable t {\n  id int [pk, increment]\n  body longtext\n  price double\n}`))
    expect(out).toContain('provider = "mysql"')
    expect(out).toMatch(/id\s+Int\s+@id @default\(autoincrement\(\)\)\n/)
    expect(out).toMatch(/body\s+String\?\s+@db\.LongText/)
  })
})

describe('Prisma round trip', () => {
  it('keeps the sample schema intact', () => {
    const { diff, warnings, a, b } = roundTrip(SAMPLE_DBML)
    expect(diff).toEqual([])
    expect(warnings).toEqual([])
    expect(b.enums).toEqual(a.enums)
    expect(b.tables.map((t) => t.note)).toEqual(a.tables.map((t) => t.note))
  })

  it('keeps types, defaults, keys, indexes, actions and schemas', () => {
    const { diff } = roundTrip(`Enum auth.role {
  admin
  "read-only"
}
Table auth.users {
  id uuid [pk, default: \`gen_random_uuid()\`]
  handle citext [unique, not null]
  role auth.role [not null, default: 'read-only']
  score "double precision" [default: 0.5]
  tags text[]
  active boolean [not null, default: true]
  seen_at timestamptz(6)
  meta jsonb
  indexes {
    (handle, role) [name: 'users_handle_role']
    meta [type: gin]
  }
}
Table posts {
  id bigint [pk, increment]
  author_id uuid [not null]
  editor_id uuid
  slug varchar(80) [unique]
  weird "geometry(Point, 4326)"
  amount decimal(12,4) [default: 0]
}
Ref fk_author: posts.author_id > auth.users.id [delete: cascade, update: no action]
Ref: posts.editor_id > auth.users.id [delete: set null]`)
    expect(diff).toEqual([])
  })

  it('keeps one-to-one, self and many-to-many relations', () => {
    const { diff, b } = roundTrip(`Table people {
  id integer [pk]
  boss_id integer [ref: > people.id]
}
Table passports {
  id integer [pk]
  person_id integer [unique, not null]
}
Ref: passports.person_id - people.id
Table clubs {
  id integer [pk]
}
Ref: people.id <> clubs.id`)
    expect(diff).toEqual([])
    expect(b.refs.map((r) => `${r.source.tableId}:${r.source.cardinality}>${r.target.tableId}:${r.target.cardinality}`).sort()).toEqual([
      'passports:one>people:one',
      'people:many>clubs:many',
      'people:many>people:one',
    ])
  })

  it('round-trips MySQL and SQLite schemas', () => {
    expect(roundTrip(`Table t {\n  id int [pk, increment]\n  body longtext [not null]\n  n tinyint\n  at datetime [default: \`now()\`]\n}`, 'mysql').diff).toEqual([])
    expect(roundTrip(`Table t {\n  id integer [pk, increment]\n  body text [not null]\n  price real\n}`, 'sqlite').diff).toEqual([])
  })
})

describe('Prisma import', () => {
  const SCHEMA = `// comment
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  USER  @map("user")
  ADMIN @map("admin")

  @@map("roles")
}

/// People who sign in
model User {
  id        String   @id @default(uuid()) @db.Uuid
  email     String   @unique
  name      String?  @db.VarChar(100)
  role      Role     @default(USER)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt
  posts     Post[]
  profile   Profile?

  @@map("users")
}

model Profile {
  id     Int    @id @default(autoincrement())
  bio    String
  userId String @unique @db.Uuid
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Post {
  id       Int     @id @default(autoincrement())
  title    String
  authorId String  @map("author_id") @db.Uuid
  author   User    @relation(fields: [authorId], references: [id], map: "posts_author_fk")
  tags     Tag[]

  @@index([title(sort: Desc), authorId], map: "post_title_idx")
  @@map("posts")
}

model Tag {
  id    Int    @id
  posts Post[]
}

view Recent {
  id Int @unique
}`

  it('reads models, enums, maps, defaults, docs and relations', () => {
    const { model, warnings } = fromPrisma(SCHEMA)
    expect(model.databaseType).toBe('PostgreSQL')
    expect(model.enums).toEqual([{ id: 'roles', name: 'roles', schema: null, values: ['user', 'admin'] }])
    expect(model.tables.map((t) => t.name)).toEqual(['users', 'Profile', 'posts', 'Tag'])
    const users = model.tables[0]
    expect(users.note).toBe('People who sign in')
    expect(users.fields.map((f) => [f.name, f.type, f.notNull, f.defaultValue])).toEqual([
      ['id', 'uuid', false, '`uuid()`'],
      ['email', 'text', true, null],
      ['name', 'varchar(100)', false, null],
      ['role', 'roles', true, "'user'"],
      ['created_at', 'timestamp', true, '`now()`'],
      ['updatedAt', 'timestamp', true, null],
    ])
    const posts = model.tables[2]
    expect(posts.indexes).toEqual([{ name: 'post_title_idx', columns: ['title', 'author_id'], unique: false, pk: false, type: null }])
    expect(model.refs.map((r) => [r.name, r.source.tableId, r.source.fields, r.source.cardinality, r.target.tableId, r.onDelete])).toEqual([
      [null, 'Profile', ['userId'], 'one', 'users', 'cascade'],
      ['posts_author_fk', 'posts', ['author_id'], 'many', 'users', null],
      [null, 'posts', ['id'], 'many', 'Tag', null],
    ])
    expect(warnings).toEqual(['Left out view Recent: only models become tables.'])
    // and the result is valid DBML
    expect(parse(toDbml(model)).tables).toHaveLength(4)
  })

  it('says where a schema is broken', () => {
    expect(() => fromPrisma('model User {\n  id Int @id(\n}')).toThrow(/^Line 3:/)
    expect(() => fromPrisma('datasource db {\n  provider = "postgresql"\n}')).toThrow(/No models or enums/)
  })
})
