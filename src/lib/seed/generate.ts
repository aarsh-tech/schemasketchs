import { Faker, base, en } from '@faker-js/faker'
import type { EnumModel, FieldModel, RefModel, SchemaModel, TableModel } from '@/lib/dbml/types'
import { typeInfo, valueFor } from './values'
import type { RowContext, Value } from './values'

/* Seed data: INSERT statements for a schema, in an order that satisfies its
   foreign keys, with values that look like what the columns hold. Pure apart
   from the (seeded) random numbers. */

export type SeedDialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql'

export interface SeedOptions {
  /** rows per table id; tables left out get `defaultRows` */
  rows?: Record<string, number>
  defaultRows?: number
  dialect: SeedDialect
  /** same seed, same data */
  seed?: number
  /** dates are made relative to this; defaults to the start of today, so a seed gives the same data all day */
  now?: Date
}

export interface SeedResult {
  sql: string
  counts: Record<string, number>
  warnings: string[]
}

type Row = Record<string, Value>

interface ForeignKey {
  columns: string[]
  parent: string
  parentColumns: string[]
  /** each parent row may be used once (one-to-one, or the key is unique) */
  distinct: boolean
  nullable: boolean
}

export const MAX_ROWS = 5000

type Side = RefModel['source']

/**
 * Which side of a relationship holds the foreign key, the way the SQL
 * exporters write it: the many side, or for one-to-one ("-") the second
 * column in the DBML, which the model keeps as the target.
 */
export function relationSides(ref: RefModel): { kind: 'many-to-one' | 'one-to-one' | 'many-to-many'; child: Side; parent: Side } {
  const many = (e: Side) => e.cardinality.endsWith('many')
  if (many(ref.source) && many(ref.target)) return { kind: 'many-to-many', child: ref.source, parent: ref.target }
  if (many(ref.source)) return { kind: 'many-to-one', child: ref.source, parent: ref.target }
  if (many(ref.target)) return { kind: 'many-to-one', child: ref.target, parent: ref.source }
  return { kind: 'one-to-one', child: ref.target, parent: ref.source }
}

/** Tables in an order where parents come before children. Cycles are broken where a key can be filled in later. */
export function insertOrder(model: SchemaModel): { order: string[]; deferred: Set<string> } {
  const deps = new Map(model.tables.map((t) => [t.id, new Set<string>()]))
  const edgeKey = (child: string, parent: string) => `${child}>${parent}`
  for (const ref of model.refs) {
    const { kind, child, parent } = relationSides(ref)
    if (kind === 'many-to-many' || child.tableId === parent.tableId) continue
    deps.get(child.tableId)?.add(parent.tableId)
  }
  const order: string[] = []
  const done = new Set<string>()
  const deferred = new Set<string>()
  while (order.length < model.tables.length) {
    const ready = model.tables.find((t) => !done.has(t.id) && [...(deps.get(t.id) ?? [])].every((d) => done.has(d) || !deps.has(d)))
    // a cycle: take the next table anyway; its keys to tables not yet filled get set afterwards
    const next = ready ?? model.tables.find((t) => !done.has(t.id))!
    if (!ready) for (const d of deps.get(next.id) ?? []) if (!done.has(d)) deferred.add(edgeKey(next.id, d))
    order.push(next.id)
    done.add(next.id)
  }
  return { order, deferred }
}

const pkOf = (t: TableModel): string[] => {
  const own = t.fields.filter((f) => f.pk).map((f) => f.name)
  return own.length ? own : (t.indexes.find((i) => i.pk)?.columns ?? [])
}

function foreignKeys(model: SchemaModel, table: TableModel): ForeignKey[] {
  const out: ForeignKey[] = []
  for (const ref of model.refs) {
    const { kind, child, parent } = relationSides(ref)
    if (kind === 'many-to-many' || child.tableId !== table.id) continue
    const fields = child.fields.map((n) => table.fields.find((f) => f.name === n))
    if (fields.some((f) => !f)) continue
    const uniqueIdx = table.indexes.some((i) => i.unique && i.columns.length === child.fields.length && child.fields.every((c) => i.columns.includes(c)))
    const pk = pkOf(table)
    const isPk = pk.length === child.fields.length && child.fields.every((c) => pk.includes(c))
    out.push({
      columns: child.fields,
      parent: parent.tableId,
      parentColumns: parent.fields,
      distinct: kind === 'one-to-one' || isPk || uniqueIdx || (child.fields.length === 1 && !!fields[0]!.unique),
      nullable: fields.every((f) => !f!.notNull && !f!.pk && !pk.includes(f!.name)),
    })
  }
  return out
}

/** Column sets that must not repeat: the primary key, unique columns and unique indexes. */
function uniqueSets(t: TableModel): string[][] {
  const sets = [pkOf(t), ...t.fields.filter((f) => f.unique && !f.pk).map((f) => [f.name]), ...t.indexes.filter((i) => i.unique || i.pk).map((i) => i.columns)]
  const seen = new Set<string>()
  return sets.filter((s) => s.length && !s.some((c) => c.startsWith('`')) && !seen.has(s.join('\u0000')) && seen.add(s.join('\u0000')))
}

const keyOf = (row: Row, cols: string[]) => JSON.stringify(cols.map((c) => normal(row[c])))
const normal = (v: Value) => (v && typeof v === 'object' ? ('date' in v ? v.date.toISOString() : v.bytes) : v)

const isIntegerType = (f: FieldModel) => {
  const k = typeInfo(f.type).kind
  return k === 'int' || k === 'bigint'
}

export function generateSeed(model: SchemaModel, opts: SeedOptions): SeedResult {
  const f = new Faker({ locale: [en, base] })
  f.seed(opts.seed ?? 1)
  const today = new Date()
  f.setDefaultRefDate(opts.now ?? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())))
  const warnings: string[] = []
  const { order, deferred } = insertOrder(model)
  const byId = new Map(model.tables.map((t) => [t.id, t]))
  // a column's type is the enum's id (auth.role); enumName is only its bare name
  const enumOf = (field: FieldModel): EnumModel | undefined =>
    field.enumName ? (model.enums.find((e) => e.id === field.type) ?? model.enums.find((e) => e.name === field.enumName)) : undefined
  const data = new Map<string, Row[]>()
  const later: { table: TableModel; fk: ForeignKey }[] = []
  const label = (t: TableModel) => (t.schema ? `${t.schema}.${t.name}` : t.name)

  if (model.refs.some((r) => relationSides(r).kind === 'many-to-many')) {
    warnings.push('Many-to-many relationships (<>) have no join table in the DBML, so nothing is generated for them.')
  }

  for (const id of order) {
    const table = byId.get(id)!
    const wanted = Math.max(0, Math.min(MAX_ROWS, Math.floor(opts.rows?.[id] ?? opts.defaultRows ?? 10)))
    const pk = pkOf(table)
    const fks = foreignKeys(model, table)
    const fkColumns = new Set(fks.flatMap((k) => k.columns))
    const uniques = uniqueSets(table)
    const taken = uniques.map(() => new Set<string>())
    // parent rows a distinct key has already used
    const used = new Map(fks.map((k) => [k, new Set<number>()]))
    const rows: Row[] = []
    let shortBy: 'parents' | 'unique' | null = null

    for (const fk of fks) if (deferred.has(`${table.id}>${fk.parent}`)) later.push({ table, fk })

    while (rows.length < wanted && !shortBy) {
      let accepted: { row: Row; picks: Map<ForeignKey, number> } | null = null
      for (let attempt = 0; attempt < 30 && !accepted && !shortBy; attempt++) {
        const ctx: RowContext = {}
        const row: Row = {}
        for (const field of table.fields) {
          if (fkColumns.has(field.name)) continue
          if (pk.length === 1 && pk[0] === field.name && isIntegerType(field)) row[field.name] = rows.length + 1
          else row[field.name] = valueFor(f, table, field, ctx, enumOf(field)?.values ?? null)
        }
        const picks = new Map<ForeignKey, number>()
        for (const fk of fks) {
          // a key to a table filled later in a cycle starts empty and is set by an UPDATE
          if (deferred.has(`${table.id}>${fk.parent}`)) {
            for (const c of fk.columns) row[c] = null
            continue
          }
          // a table can point at itself: earlier rows, or this one
          const parents = fk.parent === table.id ? [...rows, row] : (data.get(fk.parent) ?? [])
          const free = parents.map((_, n) => n).filter((n) => !fk.distinct || !used.get(fk)!.has(n))
          if (!free.length) {
            if (fk.nullable && !parents.length) {
              for (const c of fk.columns) row[c] = null
              continue
            }
            shortBy = 'parents'
            break
          }
          const pick = f.helpers.arrayElement(free)
          fk.columns.forEach((c, n) => (row[c] = parents[pick][fk.parentColumns[n]] ?? null))
          picks.set(fk, pick)
        }
        if (shortBy) break
        // a repeat of a unique value: try again with fresh values
        const clash = uniques.some((cols, n) => cols.every((c) => row[c] !== null) && taken[n].has(keyOf(row, cols)))
        if (!clash) accepted = { row, picks }
      }
      if (!accepted) {
        shortBy ??= 'unique'
        break
      }
      const { row, picks } = accepted
      uniques.forEach((cols, n) => cols.every((c) => row[c] !== null) && taken[n].add(keyOf(row, cols)))
      for (const [fk, pick] of picks) if (fk.distinct) used.get(fk)!.add(pick)
      rows.push(row)
    }

    if (rows.length < wanted) {
      const empty = fks.filter((k) => !k.nullable && k.parent !== table.id && !data.get(k.parent)?.length)
      const why = empty.length
        ? `it needs rows in ${empty.map((k) => byId.get(k.parent)?.name ?? k.parent).join(', ')} first`
        : shortBy === 'parents'
          ? 'each row needs a different row to point at and there aren’t enough'
          : 'there aren’t enough distinct values for its unique keys'
      warnings.push(`${label(table)}: made ${rows.length} of ${wanted} rows, because ${why}.`)
    }
    data.set(id, rows)
  }

  // keys in circular references, now that every table has rows
  const updates: { table: TableModel; set: Row; where: Row }[] = []
  for (const { table, fk } of later) {
    const parents = data.get(fk.parent) ?? []
    const pk = pkOf(table)
    if (!fk.nullable) {
      warnings.push(`${label(table)}.${fk.columns.join(', ')} is part of a circular reference and can’t be null, so its INSERTs will fail. Make one key in the cycle nullable.`)
    }
    if (!parents.length || !pk.length) continue
    for (const r of data.get(table.id) ?? []) {
      const p = f.helpers.arrayElement(parents)
      const set: Row = {}
      fk.columns.forEach((c, n) => (set[c] = p[fk.parentColumns[n]] ?? null))
      // the row itself stays as inserted (key empty); the UPDATE sets it
      updates.push({ table, set, where: Object.fromEntries(pk.map((c) => [c, r[c]])) })
    }
  }

  return { sql: render(order, data, updates, opts.dialect, byId), counts: Object.fromEntries(order.map((id) => [id, data.get(id)?.length ?? 0])), warnings }
}

/* ---------- SQL ---------- */

const quoteIdent: Record<SeedDialect, (s: string) => string> = {
  postgres: (s) => `"${s.replace(/"/g, '""')}"`,
  sqlite: (s) => `"${s.replace(/"/g, '""')}"`,
  mysql: (s) => `\`${s.replace(/`/g, '``')}\``,
  mssql: (s) => `[${s.replace(/]/g, ']]')}]`,
}

const pad = (n: number) => String(n).padStart(2, '0')
function formatDate(d: Date, kind: 'date' | 'datetime' | 'time'): string {
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  return kind === 'date' ? date : kind === 'time' ? time : `${date} ${time}`
}

export function sqlValue(v: Value, dialect: SeedDialect): string {
  if (v === null) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'boolean') return dialect === 'postgres' || dialect === 'mysql' ? (v ? 'TRUE' : 'FALSE') : v ? '1' : '0'
  if (typeof v === 'object' && 'date' in v) return `'${formatDate(v.date, v.kind)}'`
  if (typeof v === 'object') return dialect === 'postgres' ? `'\\x${v.bytes}'` : dialect === 'mssql' ? `0x${v.bytes}` : `X'${v.bytes}'`
  const s = v.replace(/'/g, "''")
  return dialect === 'mysql' ? `'${s.replace(/\\/g, '\\\\')}'` : dialect === 'mssql' && [...s].some((c) => c.charCodeAt(0) > 127) ? `N'${s}'` : `'${s}'`
}

function render(order: string[], data: Map<string, Row[]>, updates: { table: TableModel; set: Row; where: Row }[], dialect: SeedDialect, byId: Map<string, TableModel>): string {
  const q = quoteIdent[dialect]
  const name = (t: TableModel) => (t.schema ? `${q(t.schema)}.${q(t.name)}` : q(t.name))
  const out: string[] = [
    `-- Seed data generated by Schemasketch for ${dialect === 'postgres' ? 'PostgreSQL' : dialect === 'mysql' ? 'MySQL' : dialect === 'mssql' ? 'SQL Server' : 'SQLite'}.`,
    '-- Run it on an empty database that already has the tables.',
    '',
    dialect === 'mysql' ? 'START TRANSACTION;' : dialect === 'mssql' ? 'BEGIN TRANSACTION;' : 'BEGIN;',
    '',
  ]
  for (const id of order) {
    const t = byId.get(id)!
    const rows = data.get(id) ?? []
    if (!rows.length) continue
    const cols = t.fields.map((f) => f.name)
    const identity = t.fields.find((f) => f.pk && f.increment)
    out.push(`-- ${t.schema ? `${t.schema}.` : ''}${t.name}: ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`)
    if (dialect === 'mssql' && identity) out.push(`SET IDENTITY_INSERT ${name(t)} ON;`)
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100)
      out.push(`INSERT INTO ${name(t)} (${cols.map(q).join(', ')}) VALUES`)
      out.push(batch.map((r) => `  (${cols.map((c) => sqlValue(r[c] ?? null, dialect)).join(', ')})`).join(',\n') + ';')
    }
    if (dialect === 'mssql' && identity) out.push(`SET IDENTITY_INSERT ${name(t)} OFF;`)
    // explicit ids leave the sequence behind; move it past them
    if (dialect === 'postgres' && identity) {
      const table = t.schema ? `${t.schema}.${t.name}` : t.name
      out.push(`SELECT setval(pg_get_serial_sequence('${q(table).replace(/'/g, "''")}', '${identity.name.replace(/'/g, "''")}'), (SELECT MAX(${q(identity.name)}) FROM ${name(t)}));`)
    }
    out.push('')
  }
  if (updates.length) {
    out.push('-- keys in circular references, filled in once every table has rows')
    for (const u of updates) {
      const set = Object.entries(u.set).map(([c, v]) => `${q(c)} = ${sqlValue(v, dialect)}`).join(', ')
      const where = Object.entries(u.where).map(([c, v]) => `${q(c)} = ${sqlValue(v, dialect)}`).join(' AND ')
      out.push(`UPDATE ${name(u.table)} SET ${set} WHERE ${where};`)
    }
    out.push('')
  }
  out.push(dialect === 'mssql' ? 'COMMIT TRANSACTION;' : 'COMMIT;')
  return `${out.join('\n')}\n`
}
