/// <reference types="node" />
import { PGlite } from '@electric-sql/pglite'
import { DatabaseSync } from 'node:sqlite'
import { beforeAll, describe, expect, it } from 'vitest'
import { parse } from '@/lib/convert/testing'
import type { SchemaModel } from '@/lib/dbml/types'
import { guessKind, guessTextKind } from '@/lib/files'
import { CatalogError, catalogToModel, importCatalog, readCatalogText } from '.'
import { CATALOG_QUERIES } from './queries'

const table = (m: SchemaModel, id: string) => {
  const t = m.tables.find((x) => x.id === id)
  if (!t) throw new Error(`no table ${id} in ${m.tables.map((x) => x.id).join(', ')}`)
  return t
}
const field = (m: SchemaModel, id: string, name: string) => {
  const f = table(m, id).fields.find((x) => x.name === name)
  if (!f) throw new Error(`no column ${id}.${name}`)
  return f
}
const refFrom = (m: SchemaModel, id: string, column: string) => m.refs.find((r) => r.source.tableId === id && r.source.fields.includes(column))

describe('PostgreSQL catalog (run in PGlite)', () => {
  let json = ''
  beforeAll(async () => {
    const db = new PGlite()
    await db.exec(`
      CREATE SCHEMA auth;
      CREATE TYPE order_status AS ENUM ('pending', 'paid', 'shipped');
      CREATE TYPE auth.role AS ENUM ('admin', 'member');
      CREATE TABLE auth.users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email varchar(255) NOT NULL UNIQUE,
        role auth.role NOT NULL DEFAULT 'member',
        created_at timestamptz DEFAULT now()
      );
      COMMENT ON TABLE auth.users IS 'People who can sign in';
      COMMENT ON COLUMN auth.users.email IS 'Lower-cased';
      CREATE TABLE customers (
        id serial PRIMARY KEY,
        user_id uuid UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
        name text NOT NULL,
        score double precision DEFAULT 0.5,
        active boolean NOT NULL DEFAULT true,
        tags text[] DEFAULT '{}',
        balance numeric(10, 2) DEFAULT -1
      );
      CREATE TABLE orders (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        customer_id integer NOT NULL REFERENCES customers (id),
        status order_status NOT NULL DEFAULT 'pending',
        placed_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP,
        note varchar DEFAULT 'it''s'
      );
      CREATE INDEX orders_customer_idx ON orders (customer_id, placed_at);
      CREATE INDEX orders_lower_note ON orders (lower(note));
      CREATE INDEX orders_pending ON orders (status) WHERE status = 'pending';
      CREATE INDEX orders_note_hash ON orders USING hash (note);
      CREATE TABLE order_items (
        order_id bigint REFERENCES orders (id) ON DELETE CASCADE ON UPDATE RESTRICT,
        line integer,
        qty integer NOT NULL DEFAULT 1,
        PRIMARY KEY (order_id, line)
      );
      CREATE TABLE "Odd Name" ("Weird Col" integer);
      CREATE TABLE pairs (a integer, b integer, UNIQUE (a, b));
      CREATE TABLE links (a integer, b integer, FOREIGN KEY (a, b) REFERENCES pairs (a, b));
    `)
    const res = await db.query<{ catalog: unknown }>(CATALOG_QUERIES.postgres)
    json = JSON.stringify(res.rows[0].catalog)
    await db.close()
  }, 60_000)

  it('reads tables, schemas, columns and comments', () => {
    const { model } = catalogToModel(json)
    expect(model.databaseType).toBe('PostgreSQL')
    expect(model.tables.map((t) => t.id).sort()).toEqual(['Odd Name', 'auth.users', 'customers', 'links', 'order_items', 'orders', 'pairs'])
    const users = table(model, 'auth.users')
    expect(users.schema).toBe('auth')
    expect(users.note).toBe('People who can sign in')
    expect(users.fields.map((f) => f.name)).toEqual(['id', 'email', 'role', 'created_at'])
    expect(field(model, 'auth.users', 'email')).toMatchObject({ type: 'varchar(255)', unique: true, notNull: true, note: 'Lower-cased' })
  })

  it('turns types, enums, identities and defaults into DBML', () => {
    const { model } = catalogToModel(json)
    expect(field(model, 'auth.users', 'id')).toMatchObject({ pk: true, type: 'uuid', defaultValue: '`gen_random_uuid()`' })
    expect(field(model, 'auth.users', 'role')).toMatchObject({ type: 'auth.role', enumName: 'auth.role', defaultValue: "'member'" })
    expect(field(model, 'auth.users', 'created_at')).toMatchObject({ type: 'timestamptz', defaultValue: '`now()`' })
    expect(field(model, 'customers', 'id')).toMatchObject({ pk: true, increment: true, defaultValue: null, type: 'integer' })
    expect(field(model, 'customers', 'score')).toMatchObject({ type: 'double precision', defaultValue: '0.5' })
    expect(field(model, 'customers', 'active')).toMatchObject({ defaultValue: 'true', notNull: true })
    expect(field(model, 'customers', 'tags')).toMatchObject({ type: 'text[]', defaultValue: "'{}'" })
    expect(field(model, 'customers', 'balance')).toMatchObject({ type: 'numeric(10,2)', defaultValue: '-1' })
    expect(field(model, 'orders', 'id')).toMatchObject({ pk: true, increment: true })
    expect(field(model, 'orders', 'status')).toMatchObject({ type: 'order_status', enumName: 'order_status', defaultValue: "'pending'" })
    expect(field(model, 'orders', 'placed_at')).toMatchObject({ type: 'timestamp(3)', defaultValue: '`CURRENT_TIMESTAMP`' })
    expect(field(model, 'orders', 'note')).toMatchObject({ type: 'varchar', defaultValue: "'it\\'s'" })
    expect(model.enums.map((e) => [e.id, e.values])).toEqual([
      ['auth.role', ['admin', 'member']],
      ['order_status', ['pending', 'paid', 'shipped']],
    ])
  })

  it('reads keys, indexes and relationships', () => {
    const { model, warnings } = catalogToModel(json)
    const orders = table(model, 'orders')
    expect(orders.indexes).toEqual(
      expect.arrayContaining([
        { name: 'orders_customer_idx', columns: ['customer_id', 'placed_at'], unique: false, pk: false, type: null },
        { name: 'orders_note_hash', columns: ['note'], unique: false, pk: false, type: 'hash' },
      ]),
    )
    expect(orders.indexes.find((i) => i.name === 'orders_lower_note')?.columns[0]).toMatch(/^`lower\(.*note.*\)`$/)
    expect(warnings.some((w) => w.includes('orders_pending'))).toBe(true)
    expect(table(model, 'order_items').indexes).toContainEqual({ name: null, columns: ['order_id', 'line'], unique: false, pk: true, type: null })
    expect(table(model, 'pairs').indexes).toContainEqual(expect.objectContaining({ columns: ['a', 'b'], unique: true }))

    expect(refFrom(model, 'customers', 'user_id')).toMatchObject({
      source: { tableId: 'customers', fields: ['user_id'], cardinality: 'one' },
      target: { tableId: 'auth.users', fields: ['id'], cardinality: 'one' },
      onDelete: 'cascade',
    })
    expect(refFrom(model, 'orders', 'customer_id')).toMatchObject({ source: { cardinality: 'many' }, target: { tableId: 'customers' }, onDelete: null })
    expect(refFrom(model, 'order_items', 'order_id')).toMatchObject({ onDelete: 'cascade', onUpdate: 'restrict' })
    expect(refFrom(model, 'links', 'a')).toMatchObject({ source: { fields: ['a', 'b'] }, target: { tableId: 'pairs', fields: ['a', 'b'] } })
    expect(field(model, 'customers', 'user_id').isRef).toBe(true)
  })

  it('produces DBML that compiles and keeps the schema', () => {
    const { dbml, tables } = importCatalog(json)
    expect(tables).toBe(7)
    const back = parse(dbml)
    expect(back.tables).toHaveLength(7)
    expect(back.refs).toHaveLength(4)
    expect(back.enums.map((e) => e.id).sort()).toEqual(['auth.role', 'order_status'])
    expect(back.databaseType).toBe('PostgreSQL')
    expect(field(back, 'Odd Name', 'Weird Col').type).toBe('integer')
    expect(dbml).toMatch(/^\/\/ Imported from a PostgreSQL catalog/)
  })
})

describe('SQLite catalog (run in node:sqlite)', () => {
  let json = ''
  beforeAll(() => {
    const db = new DatabaseSync(':memory:')
    db.exec(`
      CREATE TABLE authors (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE);
      CREATE TABLE books (
        id INTEGER PRIMARY KEY,
        author_id INTEGER NOT NULL REFERENCES authors ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT 'Untitled',
        price REAL DEFAULT 9.99,
        added TEXT DEFAULT CURRENT_TIMESTAMP,
        isbn TEXT,
        UNIQUE (title, author_id)
      );
      CREATE INDEX books_added ON books (added);
      CREATE TABLE tags (book_id INTEGER REFERENCES books (id), tag TEXT, odd, PRIMARY KEY (book_id, tag)) WITHOUT ROWID;
    `)
    const row = db.prepare(CATALOG_QUERIES.sqlite).get() as { catalog: string }
    json = row.catalog
    db.close()
  })

  it('reads the schema', () => {
    const { model } = catalogToModel(json)
    expect(model.databaseType).toBe('SQLite')
    expect(model.tables.map((t) => t.id)).toEqual(['authors', 'books', 'tags'])
    expect(field(model, 'authors', 'id')).toMatchObject({ pk: true, increment: true })
    expect(field(model, 'authors', 'email')).toMatchObject({ unique: true })
    expect(field(model, 'books', 'id')).toMatchObject({ pk: true, increment: false })
    expect(field(model, 'books', 'title')).toMatchObject({ notNull: true, defaultValue: "'Untitled'" })
    expect(field(model, 'books', 'price')).toMatchObject({ defaultValue: '9.99' })
    expect(field(model, 'books', 'added')).toMatchObject({ defaultValue: '`CURRENT_TIMESTAMP`' })
    expect(field(model, 'tags', 'odd').type).toBe('blob')
    expect(table(model, 'books').indexes).toEqual(
      expect.arrayContaining([
        { name: null, columns: ['title', 'author_id'], unique: true, pk: false, type: null },
        { name: 'books_added', columns: ['added'], unique: false, pk: false, type: null },
      ]),
    )
    expect(table(model, 'tags').indexes).toContainEqual({ name: null, columns: ['book_id', 'tag'], unique: false, pk: true, type: null })
  })

  it('fills in a reference to the primary key when the columns are left out', () => {
    const { model } = catalogToModel(json)
    expect(refFrom(model, 'books', 'author_id')).toMatchObject({ target: { tableId: 'authors', fields: ['id'] }, onDelete: 'cascade' })
    expect(refFrom(model, 'tags', 'book_id')).toMatchObject({ target: { tableId: 'books', fields: ['id'] } })
    expect(parse(importCatalog(json).dbml).refs).toHaveLength(2)
  })
})

describe('MySQL and SQL Server catalogs', () => {
  // shaped like the output of the MySQL query
  const mysql = {
    dialect: 'mysql',
    tables: [
      { schema: 'shop', table: 'users', comment: '' },
      { schema: 'shop', table: 'orders', comment: 'Placed orders' },
    ],
    columns: [
      { schema: 'shop', table: 'users', column: 'id', position: 1, type: 'int unsigned', nullable: 0, default: null, extra: 'auto_increment', comment: '' },
      { schema: 'shop', table: 'users', column: 'email', position: 2, type: 'varchar(255)', nullable: 0, default: null, extra: '', comment: 'Login' },
      { schema: 'shop', table: 'users', column: 'active', position: 3, type: 'tinyint(1)', nullable: 0, default: '1', extra: '', comment: '' },
      { schema: 'shop', table: 'orders', column: 'id', position: 1, type: 'bigint', nullable: 0, default: null, extra: 'auto_increment', comment: '' },
      { schema: 'shop', table: 'orders', column: 'user_id', position: 2, type: 'int unsigned', nullable: 1, default: null, extra: '', comment: '' },
      { schema: 'shop', table: 'orders', column: 'status', position: 3, type: "enum('new','paid','it''s')", nullable: 0, default: 'new', extra: '', comment: '' },
      { schema: 'shop', table: 'orders', column: 'code', position: 4, type: 'varchar(10)', nullable: 1, default: '007', extra: '', comment: '' },
      { schema: 'shop', table: 'orders', column: 'placed', position: 5, type: 'datetime', nullable: 1, default: 'CURRENT_TIMESTAMP', extra: 'DEFAULT_GENERATED', comment: '' },
    ],
    indexes: [
      { schema: 'shop', table: 'users', name: 'PRIMARY', column: 'id', seq: 1, unique: 1, primary: 1, method: 'BTREE' },
      { schema: 'shop', table: 'users', name: 'email', column: 'email', seq: 1, unique: 1, primary: 0, method: 'BTREE' },
      { schema: 'shop', table: 'orders', name: 'PRIMARY', column: 'id', seq: 1, unique: 1, primary: 1, method: 'BTREE' },
      { schema: 'shop', table: 'orders', name: 'orders_user_fk', column: 'user_id', seq: 1, unique: 0, primary: 0, method: 'BTREE' },
      { schema: 'shop', table: 'orders', name: 'ft_code', column: 'code', seq: 1, unique: 0, primary: 0, method: 'FULLTEXT' },
    ],
    foreign_keys: [
      { schema: 'shop', table: 'orders', name: 'orders_user_fk', column: 'user_id', seq: 1, ref_schema: 'shop', ref_table: 'users', ref_column: 'id', on_delete: 'SET NULL', on_update: 'NO ACTION' },
    ],
  }

  it('reads MySQL column enums, unquoted defaults and auto_increment', () => {
    const { model } = catalogToModel(JSON.stringify(mysql))
    expect(model.tables.map((t) => [t.id, t.schema])).toEqual([
      ['users', null],
      ['orders', null],
    ])
    expect(field(model, 'users', 'id')).toMatchObject({ pk: true, increment: true, type: 'int unsigned' })
    expect(field(model, 'users', 'email')).toMatchObject({ unique: true, note: 'Login' })
    expect(field(model, 'users', 'active').defaultValue).toBe('true')
    expect(table(model, 'users').note).toBeNull()
    expect(field(model, 'orders', 'status')).toMatchObject({ type: 'orders_status', enumName: 'orders_status', defaultValue: "'new'" })
    expect(model.enums).toEqual([{ id: 'orders_status', name: 'orders_status', schema: null, values: ['new', 'paid', "it's"] }])
    expect(field(model, 'orders', 'code').defaultValue).toBe("'007'")
    expect(field(model, 'orders', 'placed').defaultValue).toBe('`CURRENT_TIMESTAMP`')
    expect(refFrom(model, 'orders', 'user_id')).toMatchObject({ onDelete: 'set null', onUpdate: null, source: { cardinality: 'many' } })
    const back = parse(importCatalog(JSON.stringify(mysql)).dbml)
    expect(back.tables).toHaveLength(2)
    expect(table(back, 'orders').indexes.map((i) => i.type)).toContain('fulltext')
  })

  it('reads SQL Server defaults wrapped in brackets and drops the dbo schema', () => {
    const mssql = {
      dialect: 'mssql',
      tables: [
        { schema: 'dbo', table: 'people', comment: null },
        { schema: 'hr', table: 'staff', comment: 'Employees' },
      ],
      columns: [
        { schema: 'dbo', table: 'people', column: 'id', position: 1, type: 'int', nullable: false, default: null, identity: true, comment: null },
        { schema: 'dbo', table: 'people', column: 'name', position: 2, type: 'nvarchar(100)', nullable: false, default: "(N'nobody')", identity: false, comment: null },
        { schema: 'dbo', table: 'people', column: 'joined', position: 3, type: 'datetime2', nullable: true, default: '(getdate())', identity: false, comment: null },
        { schema: 'dbo', table: 'people', column: 'level', position: 4, type: 'int', nullable: true, default: '((0))', identity: false, comment: null },
        { schema: 'hr', table: 'staff', column: 'person_id', position: 1, type: 'int', nullable: false, default: null, identity: false, comment: null },
      ],
      indexes: [
        { schema: 'dbo', table: 'people', name: 'PK_people', column: 'id', seq: 1, unique: true, primary: true, partial: false },
        { schema: 'hr', table: 'staff', name: 'PK_staff', column: 'person_id', seq: 1, unique: true, primary: true, partial: false },
      ],
      foreign_keys: [
        { schema: 'hr', table: 'staff', name: 'FK_staff_people', column: 'person_id', seq: 1, ref_schema: 'dbo', ref_table: 'people', ref_column: 'id', on_delete: 'CASCADE', on_update: 'NO_ACTION' },
      ],
    }
    const { model } = catalogToModel(JSON.stringify(mssql))
    expect(model.tables.map((t) => t.id)).toEqual(['people', 'hr.staff'])
    expect(field(model, 'people', 'id')).toMatchObject({ pk: true, increment: true })
    expect(field(model, 'people', 'name').defaultValue).toBe("'nobody'")
    expect(field(model, 'people', 'joined').defaultValue).toBe('`getdate()`')
    expect(field(model, 'people', 'level').defaultValue).toBe('0')
    expect(refFrom(model, 'hr.staff', 'person_id')).toMatchObject({ source: { cardinality: 'one' }, target: { tableId: 'people' }, onDelete: 'cascade' })
    expect(parse(importCatalog(JSON.stringify(mssql)).dbml).refs).toHaveLength(1)
  })

  it('warns about keys that point outside the catalog', () => {
    const lone = { ...mysql, foreign_keys: [{ ...mysql.foreign_keys[0], ref_table: 'elsewhere' }] }
    const { model, warnings } = catalogToModel(JSON.stringify(lone))
    expect(model.refs).toHaveLength(0)
    expect(warnings[0]).toMatch(/elsewhere/)
  })
})

describe('reading what was pasted', () => {
  const value = { dialect: 'postgres', tables: [], columns: [{ schema: 'public', table: 't', column: 'a', position: 1, type: 'integer', nullable: true }] }

  it('accepts psql output with a header, wrapped lines and a row count', () => {
    const raw = JSON.stringify(value)
    const cut = Math.floor(raw.length / 2)
    const psql = ` catalog\n---------\n ${raw.slice(0, cut)}+\n ${raw.slice(cut)}\n(1 row)\n`
    // psql's continuation marks sit outside strings, so a cut inside a string isn't possible here
    expect(readCatalogText(psql.replace(/\+\n /, '+\n'))).toEqual(value)
  })

  it('accepts a CSV-quoted cell and a value split over rows', () => {
    const raw = JSON.stringify(value)
    expect(readCatalogText(`"${raw.replace(/"/g, '""')}"`)).toEqual(value)
    expect(readCatalogText(`${raw.slice(0, 20)}\r\n${raw.slice(20)}`)).toEqual(value)
  })

  it('explains what went wrong', () => {
    expect(() => readCatalogText('hello')).toThrow(CatalogError)
    expect(() => readCatalogText('{ "dialect": }')).toThrow(/valid JSON/)
    expect(() => catalogToModel('{"columns": []}')).toThrow(/which database/)
  })

  it('recognises catalog JSON', () => {
    expect(guessTextKind(JSON.stringify(value))).toBe('database')
    expect(guessKind('catalog.json', JSON.stringify(value))).toBe('database')
    expect(guessKind('shop.json', '{"app":"schemasketch","source":""}')).toBe('project')
  })
})
