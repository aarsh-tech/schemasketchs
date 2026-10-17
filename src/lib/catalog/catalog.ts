import { dbmlName } from '@/lib/convert/dbml'
import type { ImportResult } from '@/lib/convert/shared'
import { parseType, typeKind } from '@/lib/convert/shared'
import { tableKey } from '@/lib/dbml/normalize'
import type { EnumModel, FieldModel, IndexModel, RefModel, SchemaModel, TableModel } from '@/lib/dbml/types'
import { uniqueName } from '@/lib/dbml/values'
import type { CatalogDialect } from './queries'

/* The JSON the catalog queries return → SchemaModel. Pure, and forgiving
   about how the value was copied out of a database client. */

type Row = Record<string, unknown>

export class CatalogError extends Error {}

const DIALECTS: CatalogDialect[] = ['postgres', 'mysql', 'sqlite', 'mssql']

export const DATABASE_LABEL: Record<CatalogDialect, string> = { postgres: 'PostgreSQL', mysql: 'MySQL', sqlite: 'SQLite', mssql: 'SQL Server' }

/**
 * Pull the JSON value out of whatever was pasted: a bare value, a cell copied
 * with a header and row count (psql), a CSV-quoted cell, or SQL Server's
 * result split over several rows.
 */
export function readCatalogText(text: string): Row {
  let t = text.trim()
  // a CSV/TSV cell: "{""dialect"":…}"
  if (/^"\{/.test(t) && /\}"$/.test(t)) t = t.slice(1, -1).replace(/""/g, '"')
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start < 0 || end < start) throw new CatalogError('Paste the single JSON value the query returns. It starts with { and ends with }.')
  // JSON strings can't hold raw line breaks, so any here came from the client wrapping its output
  const body = t
    .slice(start, end + 1)
    .replace(/[ \t]*\+[ \t]*\r?\n/g, '')
    .replace(/\r?\n/g, '')
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    throw new CatalogError('That isn’t valid JSON. Copy the whole value from the result, from the first { to the last }. Some clients cut long values short; the tips above say how to get it all.')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new CatalogError('Paste the JSON object the query returns, not part of it.')
  const row = data as Row
  if (!Array.isArray(row.columns) && row.columns != null) throw new CatalogError('This JSON has no "columns" list, so it didn’t come from the catalog query.')
  return row
}

/* ---------- reading values ---------- */

const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null)
const text = (v: unknown): string | null => {
  const s = str(v)?.trim()
  return s ? s : null
}
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0)
const bool = (v: unknown): boolean => v === true || v === 1 || (typeof v === 'string' && /^(1|t|true|y|yes)$/i.test(v.trim()))
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.filter((r): r is Row => !!r && typeof r === 'object') : [])

/* ---------- types ---------- */

const PG_TYPES: [RegExp, string][] = [
  [/^character varying/, 'varchar'],
  [/^character(?= |\(|$)/, 'char'],
  [/^bit varying/, 'varbit'],
  [/^timestamp(\(\d+\))? without time zone/, 'timestamp$1'],
  [/^timestamp(\(\d+\))? with time zone/, 'timestamptz$1'],
  [/^time(\(\d+\))? without time zone/, 'time$1'],
  [/^time(\(\d+\))? with time zone/, 'timetz$1'],
]

function cleanType(raw: string, dialect: CatalogDialect): string {
  let t = raw.trim()
  if (!t) return dialect === 'sqlite' ? 'blob' : 'text'
  if (dialect === 'postgres') for (const [re, to] of PG_TYPES) t = t.replace(re, to)
  return t
}

/** Strip identifier quotes and split schema.name. */
function splitQualified(raw: string): { schema: string | null; name: string } {
  const parts = raw.match(/"(?:[^"]|"")*"|[^.]+/g) ?? [raw]
  const clean = parts.map((p) => (p.startsWith('"') ? p.slice(1, -1).replace(/""/g, '"') : p))
  return clean.length > 1 ? { schema: clean[clean.length - 2], name: clean[clean.length - 1] } : { schema: null, name: clean[0] }
}

/** MySQL enum('a','b') / set(…) values. */
function quotedValues(list: string): string[] {
  return [...list.matchAll(/'((?:[^'\\]|''|\\.)*)'/g)].map((m) => m[1].replace(/''/g, "'").replace(/\\(.)/g, '$1'))
}

/* ---------- defaults ---------- */

const dbmlString = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const NUMBER = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/
const NOW_LIKE = /^(current_timestamp|current_date|current_time|localtimestamp|localtime|now|getdate|sysdatetime|getutcdate|newid|uuid)\b/i

/** Split a leading SQL string literal ('it''s', N'x', E'x') from what follows it. */
function leadingLiteral(v: string): { value: string; rest: string } | null {
  const m = /^[NnEe]?'((?:[^']|'')*)'/.exec(v)
  return m ? { value: m[1].replace(/''/g, "'"), rest: v.slice(m[0].length) } : null
}

function stripParens(v: string): string {
  let s = v.trim()
  while (s.startsWith('(') && s.endsWith(')')) {
    // only strip when the outer pair matches each other
    let depth = 0
    let wraps = true
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++
      else if (s[i] === ')') depth--
      if (depth === 0 && i < s.length - 1) {
        wraps = false
        break
      }
    }
    if (!wraps) break
    s = s.slice(1, -1).trim()
  }
  return s
}

interface DefaultResult {
  value: string | null
  increment: boolean
}

function toDefault(raw: unknown, dialect: CatalogDialect, type: string, extra: string): DefaultResult {
  let v = str(raw)?.trim()
  if (v == null || v === '') return { value: null, increment: false }
  const kind = typeKind(parseType(type).base)
  const stringy = kind === 'string' || kind === 'uuid' || kind === 'date' || kind === 'datetime' || kind === 'time' || kind === 'json'

  if (dialect === 'mssql') v = stripParens(v)
  if (/^nextval\(/i.test(v)) return { value: null, increment: true }
  if (/^null(::.*)?$/i.test(v)) return { value: null, increment: false }

  if (dialect === 'mysql' && !/DEFAULT_GENERATED/i.test(extra) && !leadingLiteral(v) && !NOW_LIKE.test(v)) {
    // MySQL reports literal defaults without their quotes
    if ((kind === 'bool' || /^tinyint\(1\)/i.test(type)) && /^[01]$/.test(v)) return { value: v === '1' ? 'true' : 'false', increment: false }
    if (!stringy && NUMBER.test(v)) return { value: v, increment: false }
    return { value: dbmlString(v), increment: false }
  }

  const lit = leadingLiteral(v)
  // 'text'::type casts (PostgreSQL) carry nothing DBML needs
  if (lit && (lit.rest === '' || /^(::[\w ."[\]()]+)+$/.test(lit.rest))) {
    if (!stringy && NUMBER.test(lit.value)) return { value: lit.value, increment: false }
    if (kind === 'bool' && /^(t|true|f|false)$/i.test(lit.value)) return { value: /^t/i.test(lit.value) ? 'true' : 'false', increment: false }
    return { value: dbmlString(lit.value), increment: false }
  }
  const bare = v.replace(/^\((-?[\d.]+)\)(::[\w ."[\]()]+)?$/, '$1').replace(/::[\w ."[\]()]+$/, '')
  if (NUMBER.test(bare)) return { value: bare, increment: false }
  if (/^(true|false)$/i.test(bare)) return { value: bare.toLowerCase(), increment: false }
  return { value: `\`${v.replace(/`/g, "'")}\``, increment: false }
}

/* ---------- referential actions ---------- */

const PG_ACTION: Record<string, string> = { a: 'no action', r: 'restrict', c: 'cascade', n: 'set null', d: 'set default' }

function action(raw: unknown): string | null {
  const v = text(raw)
  if (!v) return null
  const a = (PG_ACTION[v] ?? v).toLowerCase().replace(/_/g, ' ')
  // "no action" is what you get when nothing is said, so leave it out
  return a === 'no action' ? null : a
}

/* ---------- the model ---------- */

const DEFAULT_SCHEMA: Record<CatalogDialect, string | null> = { postgres: 'public', mssql: 'dbo', mysql: null, sqlite: null }

export function catalogToModel(input: string | Row): ImportResult & { dialect: CatalogDialect } {
  const data = typeof input === 'string' ? readCatalogText(input) : input
  const dialect = DIALECTS.find((d) => d === data.dialect)
  if (!dialect) throw new CatalogError('The JSON doesn’t say which database it came from. Run the catalog query exactly as shown, without changing it.')
  const warnings: string[] = []

  // MySQL and SQLite only ever read one database, so their schema names add nothing
  const schemaOf = (r: Row): string | null => {
    if (dialect === 'mysql' || dialect === 'sqlite') return null
    const s = text(r.schema)
    return s && s !== DEFAULT_SCHEMA[dialect] ? s : null
  }
  const keyOf = (schema: string | null, name: string) => tableKey(schema, name)
  const rowKey = (r: Row, prefix = '') => {
    const name = text(r[`${prefix}table`]) ?? ''
    const schema = prefix ? schemaOf({ schema: r.ref_schema }) : schemaOf(r)
    return keyOf(schema, name)
  }

  /* enums (PostgreSQL) */
  const enumMap = new Map<string, EnumModel>()
  for (const r of [...rows(data.enums)].sort((a, b) => num(a.seq) - num(b.seq))) {
    const name = text(r.name)
    const value = str(r.value)
    if (!name || value == null) continue
    const schema = schemaOf(r)
    const id = keyOf(schema, name)
    const e = enumMap.get(id) ?? { id, name, schema, values: [] }
    e.values.push(value)
    enumMap.set(id, e)
  }
  const findEnum = (type: string): EnumModel | undefined => {
    const { schema, name } = splitQualified(type)
    return enumMap.get(keyOf(schema && schema !== DEFAULT_SCHEMA[dialect] ? schema : null, name))
  }
  const enumTypeName = (e: EnumModel) => (e.schema ? `${dbmlName(e.schema)}.${dbmlName(e.name)}` : dbmlName(e.name))

  /* tables, in the order the database lists them */
  const tables = new Map<string, TableModel>()
  const tableOf = (r: Row): TableModel | null => {
    const name = text(r.table)
    if (!name) return null
    const schema = schemaOf(r)
    const id = keyOf(schema, name)
    let t = tables.get(id)
    if (!t) {
      t = { id, name, schema, alias: null, note: null, headerColor: null, groupId: null, fields: [], indexCount: 0, indexes: [] }
      tables.set(id, t)
    }
    return t
  }
  for (const r of rows(data.tables)) {
    const t = tableOf(r)
    if (t) t.note = text(r.comment)
  }

  /* columns */
  const pkFromColumns = new Map<string, { name: string; order: number }[]>()
  const columnRows = [...rows(data.columns)].sort((a, b) => num(a.position) - num(b.position))
  for (const r of columnRows) {
    const t = tableOf(r)
    const name = str(r.column)
    if (!t || !name) continue
    const rawType = text(r.type) ?? ''
    let type = cleanType(rawType, dialect)
    let enumName: string | null = null

    const mysqlEnum = /^enum\((.*)\)$/is.exec(rawType)
    if (mysqlEnum) {
      // MySQL enums belong to a column; DBML enums are named, so give each one a name
      const id = uniqueName(`${t.name}_${name}`, enumMap.keys())
      const e: EnumModel = { id, name: id, schema: null, values: quotedValues(mysqlEnum[1]) }
      enumMap.set(id, e)
      type = enumTypeName(e)
      enumName = e.id
    } else {
      const e = findEnum(rawType)
      if (e) {
        type = enumTypeName(e)
        enumName = e.id
      }
    }

    const extra = str(r.extra) ?? ''
    const def = toDefault(r.default, dialect, type, extra)
    const pkOrder = num(r.pk)
    if (pkOrder > 0) {
      const list = pkFromColumns.get(t.id) ?? []
      list.push({ name, order: pkOrder })
      pkFromColumns.set(t.id, list)
    }
    const field: FieldModel = {
      name,
      type,
      pk: false,
      unique: false,
      notNull: !bool(r.nullable),
      increment: bool(r.identity) || def.increment || /auto_increment/i.test(extra),
      defaultValue: def.value,
      note: text(r.comment),
      enumName,
      isRef: false,
    }
    t.fields.push(field)
  }

  /* indexes and keys */
  type IndexRows = { table: TableModel; name: string | null; rows: Row[] }
  const indexGroups = new Map<string, IndexRows>()
  for (const r of rows(data.indexes)) {
    const t = tables.get(rowKey(r))
    if (!t) continue
    const name = text(r.name)
    const k = `${t.id}\u0000${name ?? ''}`
    const g = indexGroups.get(k) ?? { table: t, name, rows: [] }
    g.rows.push(r)
    indexGroups.set(k, g)
  }
  const pks = new Map<string, string[]>()
  for (const [id, cols] of pkFromColumns) pks.set(id, cols.sort((a, b) => a.order - b.order).map((c) => c.name))

  for (const g of indexGroups.values()) {
    const sorted = g.rows.sort((a, b) => num(a.seq) - num(b.seq))
    const first = sorted[0]
    const label = g.name ? `Index ${g.name} on ${g.table.name}` : `An index on ${g.table.name}`
    const columns: string[] = []
    let unreadable = false
    for (const r of sorted) {
      const col = str(r.column)
      const expr = text(r.expression)
      if (col) columns.push(col)
      else if (expr) columns.push(`\`${expr.replace(/`/g, "'")}\``)
      else unreadable = true
    }
    if (unreadable || !columns.length) {
      warnings.push(`${label} uses an expression the catalog doesn’t show, so it was left out.`)
      continue
    }
    if (bool(first.primary)) {
      if (!pks.has(g.table.id)) pks.set(g.table.id, columns)
      continue
    }
    const unique = bool(first.unique)
    if (bool(first.partial)) warnings.push(`${label} only covers some rows (it has a WHERE clause). It was imported as a plain index.`)
    const method = text(first.method)?.toLowerCase() ?? null
    const type = method && !['btree', 'clustered', 'nonclustered'].includes(method) ? method : null
    const generated = !!g.name && /^sqlite_autoindex_/.test(g.name)

    if (unique && columns.length === 1 && !columns[0].startsWith('`') && !bool(first.partial)) {
      const f = g.table.fields.find((x) => x.name === columns[0])
      if (f) {
        f.unique = true
        continue
      }
    }
    g.table.indexes.push({ name: generated ? null : g.name, columns, unique, pk: false, type })
  }

  for (const [id, columns] of pks) {
    const t = tables.get(id)
    if (!t) continue
    if (columns.length === 1) {
      const f = t.fields.find((x) => x.name === columns[0])
      if (f) {
        f.pk = true
        // a primary key is already unique and not null; say it once
        f.unique = false
        f.notNull = false
        continue
      }
    }
    t.indexes.unshift({ name: null, columns, unique: false, pk: true, type: null } satisfies IndexModel)
  }
  for (const t of tables.values()) t.indexCount = t.indexes.length

  /* foreign keys */
  const fkGroups = new Map<string, Row[]>()
  for (const r of rows(data.foreign_keys)) {
    const k = `${rowKey(r)}\u0000${text(r.name) ?? `#${str(r.id) ?? ''}`}`
    fkGroups.set(k, [...(fkGroups.get(k) ?? []), r])
  }
  const refs: RefModel[] = []
  for (const group of fkGroups.values()) {
    const sorted = group.sort((a, b) => num(a.seq) - num(b.seq))
    const first = sorted[0]
    const child = tables.get(rowKey(first))
    const parent = tables.get(rowKey(first, 'ref_'))
    if (!child) continue
    if (!parent) {
      warnings.push(`${child.name} has a foreign key to ${text(first.ref_table) ?? 'a table'} that the catalog didn’t include (it may be in another schema or database), so the relationship was left out.`)
      continue
    }
    const fields = sorted.map((r) => str(r.column)).filter((c): c is string => !!c)
    let targets = sorted.map((r) => str(r.ref_column)).filter((c): c is string => !!c)
    // SQLite leaves the referenced columns out when the key points at the primary key
    if (!targets.length) targets = pks.get(parent.id) ?? []
    if (!fields.length || fields.length !== targets.length) {
      warnings.push(`A foreign key from ${child.name} to ${parent.name} couldn’t be read, so it was left out.`)
      continue
    }
    const childFields = fields.map((n) => child.fields.find((f) => f.name === n))
    childFields.forEach((f) => f && (f.isRef = true))
    targets.forEach((n) => {
      const f = parent.fields.find((x) => x.name === n)
      if (f) f.isRef = true
    })
    const childPk = pks.get(child.id) ?? []
    const oneToOne =
      (fields.length === 1 && !!(childFields[0]?.unique || (childPk.length === 1 && childPk[0] === fields[0]))) ||
      child.indexes.some((i) => (i.unique || i.pk) && i.columns.length === fields.length && i.columns.every((c) => fields.includes(c))) ||
      (childPk.length === fields.length && childPk.every((c) => fields.includes(c)))
    refs.push({
      id: `ref:${refs.length + 1}`,
      name: null,
      source: { tableId: child.id, fields, cardinality: oneToOne ? 'one' : 'many' },
      target: { tableId: parent.id, fields: targets, cardinality: 'one' },
      onDelete: action(first.on_delete),
      onUpdate: action(first.on_update),
    })
  }

  const model: SchemaModel = {
    databaseType: DATABASE_LABEL[dialect],
    projectName: null,
    tables: [...tables.values()].filter((t) => t.fields.length > 0),
    refs,
    groups: [],
    enums: [...enumMap.values()],
    notes: [],
  }
  for (const t of tables.values()) if (!t.fields.length) warnings.push(`Table ${t.name} has no columns, so it was left out.`)
  return { model, warnings, dialect }
}
