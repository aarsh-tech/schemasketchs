import { tableKey } from '@/lib/dbml/normalize'
import type { FieldModel, IndexModel, RefEndpoint, RefModel, SchemaModel, TableModel } from '@/lib/dbml/types'

/* Helpers shared by the ORM converters. Pure, and free of the DBML compiler. */

export interface ImportResult {
  model: SchemaModel
  /** things the source had that DBML can't hold, said in plain words */
  warnings: string[]
}

/* ---------- column types ---------- */

export interface ParsedType {
  /** lower-case base name with aliases resolved, e.g. "varchar", "timestamptz", "double precision" */
  base: string
  /** arguments inside the parentheses, e.g. ["10", "2"] */
  args: string[]
  array: boolean
}

const TYPE_ALIASES: Record<string, string> = {
  'character varying': 'varchar',
  character: 'char',
  'timestamp with time zone': 'timestamptz',
  'timestamp without time zone': 'timestamp',
  'time with time zone': 'timetz',
  'time without time zone': 'time',
  int4: 'integer',
  int: 'integer',
  int2: 'smallint',
  int8: 'bigint',
  bool: 'boolean',
  float8: 'double precision',
  float4: 'real',
}

export function parseType(type: string): ParsedType {
  let t = type.trim().replace(/^"(.*)"$/, '$1')
  let array = false
  while (t.endsWith('[]')) {
    array = true
    t = t.slice(0, -2).trim()
  }
  const m = /\(([^)]*)\)/.exec(t)
  const args = m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : []
  const base = (m ? t.slice(0, m.index) + t.slice(m.index + m[0].length) : t).trim().toLowerCase().replace(/\s+/g, ' ')
  return { base: TYPE_ALIASES[base] ?? base, args, array }
}

export type TypeKind = 'int' | 'bigint' | 'float' | 'decimal' | 'string' | 'uuid' | 'bool' | 'date' | 'datetime' | 'time' | 'json' | 'bytes' | 'unknown'

const KINDS: [TypeKind, string[]][] = [
  ['int', ['integer', 'smallint', 'tinyint', 'mediumint', 'serial', 'smallserial', 'serial4', 'serial2', 'year']],
  ['bigint', ['bigint', 'bigserial', 'serial8']],
  ['float', ['real', 'float', 'double', 'double precision']],
  ['decimal', ['decimal', 'numeric', 'money', 'smallmoney']],
  ['string', ['text', 'varchar', 'char', 'nvarchar', 'nchar', 'ntext', 'citext', 'tinytext', 'mediumtext', 'longtext', 'string', 'inet', 'cidr', 'macaddr', 'macaddr8', 'xml', 'interval', 'bit', 'varbit']],
  ['uuid', ['uuid', 'uniqueidentifier']],
  ['bool', ['boolean']],
  ['date', ['date']],
  ['datetime', ['timestamp', 'timestamptz', 'datetime', 'datetime2', 'smalldatetime', 'datetimeoffset']],
  ['time', ['time', 'timetz']],
  ['json', ['json', 'jsonb']],
  ['bytes', ['bytea', 'blob', 'tinyblob', 'mediumblob', 'longblob', 'binary', 'varbinary', 'image']],
]
const KIND_OF = new Map(KINDS.flatMap(([kind, names]) => names.map((n) => [n, kind] as const)))

export const typeKind = (base: string): TypeKind => KIND_OF.get(base) ?? 'unknown'

/* ---------- defaults ---------- */

export type DefaultValue =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' }
  | { kind: 'expression'; value: string }

/** Read a default in the form the parser model keeps it: 'text', `expr`, 42, true, null. */
export function readDefault(v: string | null): DefaultValue | null {
  if (v == null) return null
  const s = v.trim()
  if (/^'.*'$/s.test(s)) return { kind: 'string', value: s.slice(1, -1).replace(/\\(.)/g, '$1') }
  if (/^`.*`$/s.test(s)) return { kind: 'expression', value: s.slice(1, -1) }
  if (/^(true|false)$/i.test(s)) return { kind: 'boolean', value: s.toLowerCase() === 'true' }
  if (/^null$/i.test(s)) return { kind: 'null' }
  if (/^-?\d+(\.\d+)?$/.test(s)) return { kind: 'number', value: s }
  return { kind: 'expression', value: s }
}

export const dbmlString = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

export function writeDefault(d: DefaultValue): string {
  switch (d.kind) {
    case 'string':
      return dbmlString(d.value)
    case 'number':
      return d.value
    case 'boolean':
      return String(d.value)
    case 'null':
      return 'null'
    case 'expression':
      return `\`${d.value}\``
  }
}

/** Expressions that mean "the current time" in the common dialects. */
export const isNowExpression = (e: string) => /^(now\(\)|current_timestamp(\(\d*\))?|localtimestamp|getdate\(\)|sysdate)$/i.test(e.trim())

/* ---------- building models ---------- */

export function makeField(name: string, type: string, patch: Partial<FieldModel> = {}): FieldModel {
  return { name, type, pk: false, unique: false, notNull: false, increment: false, defaultValue: null, note: null, enumName: null, isRef: false, ...patch }
}

export function makeTable(name: string, schema: string | null, patch: Partial<TableModel> = {}): TableModel {
  const s = schema && schema !== 'public' ? schema : null
  return { id: tableKey(s, name), name, schema: s, alias: null, note: null, headerColor: null, groupId: null, fields: [], indexCount: 0, indexes: [], ...patch }
}

export const makeIndex = (columns: string[], patch: Partial<IndexModel> = {}): IndexModel => ({ name: null, columns, unique: false, pk: false, type: null, ...patch })

/** Fill in the derived parts (isRef, indexCount) once tables and refs are known. */
export function finishModel(model: SchemaModel): SchemaModel {
  const inRef = new Set<string>()
  for (const r of model.refs) for (const e of [r.source, r.target]) for (const f of e.fields) inRef.add(`${e.tableId}\0${f}`)
  for (const t of model.tables) {
    t.indexCount = t.indexes.length
    for (const f of t.fields) f.isRef = inRef.has(`${t.id}\0${f.name}`)
  }
  return model
}

export const emptyModel = (): SchemaModel => ({ databaseType: null, projectName: null, tables: [], refs: [], groups: [], enums: [], notes: [] })

/* ---------- relationships ---------- */

export interface Relation {
  ref: RefModel
  kind: 'many-to-one' | 'one-to-one' | 'many-to-many'
  /** the side holding the foreign key columns */
  child: RefEndpoint
  /** the referenced side */
  parent: RefEndpoint
}

/** Primary key columns: a composite `[pk]` index wins over column flags. */
export function primaryKey(t: TableModel): string[] {
  const index = t.indexes.find((i) => i.pk)
  return index ? index.columns : t.fields.filter((f) => f.pk).map((f) => f.name)
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))

export function relationsOf(model: SchemaModel): Relation[] {
  const byId = new Map(model.tables.map((t) => [t.id, t]))
  return model.refs.map((ref) => {
    const many = (e: RefEndpoint) => e.cardinality.endsWith('many')
    if (many(ref.source) && many(ref.target)) return { ref, kind: 'many-to-many', child: ref.source, parent: ref.target }
    if (many(ref.source) || many(ref.target)) {
      const [child, parent] = many(ref.source) ? [ref.source, ref.target] : [ref.target, ref.source]
      return { ref, kind: 'many-to-one', child, parent }
    }
    // one-to-one: the foreign key sits on the side that isn't the primary key
    const isPk = (e: RefEndpoint) => {
      const t = byId.get(e.tableId)
      return !!t && sameSet(primaryKey(t), e.fields)
    }
    const swap = isPk(ref.source) && !isPk(ref.target)
    return { ref, kind: 'one-to-one', child: swap ? ref.target : ref.source, parent: swap ? ref.source : ref.target }
  })
}

/* ---------- names ---------- */

/** Split an identifier into lower-case words: "userID_v2" → ["user", "id", "v2"]. */
export function words(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)

export function camel(s: string): string {
  const [first = '', ...rest] = words(s)
  return first + rest.map(cap).join('')
}

export const pascal = (s: string) => words(s).map(cap).join('')

const JS_RESERVED = new Set(
  'break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await arguments eval undefined NaN Infinity'.split(' '),
)

export const isJsIdentifier = (s: string) => /^[A-Za-z_$][\w$]*$/.test(s) && !JS_RESERVED.has(s)

/** Make `s` a valid identifier for `valid`, falling back to a cleaned-up version. */
export function toIdentifier(s: string, valid: (s: string) => boolean, fallback = 'x'): string {
  if (valid(s)) return s
  let t = s.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  if (!/^[A-Za-z]/.test(t)) t = `${fallback}${t ? `_${t}` : ''}`
  return valid(t) ? t : `${t}_`
}

/** Claim the first free name of the form base, base2, base3… in `used` (case-sensitive). */
export function claim(base: string, used: Set<string>): string {
  let name = base
  for (let i = 2; used.has(name); i++) name = `${base}${i}`
  used.add(name)
  return name
}

/** A JS property key: bare when possible, quoted otherwise. */
export const jsKey = (s: string) => (/^[A-Za-z_$][\w$]*$/.test(s) ? s : JSON.stringify(s))

export const jsString = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`

/** `/** … *\/` doc comment lines for a note, indented. */
export function jsDoc(note: string | null, indent = ''): string[] {
  if (!note?.trim()) return []
  const lines = note.trim().replace(/\*\//g, '* /').split('\n')
  return lines.length === 1 ? [`${indent}/** ${lines[0]} */`] : [`${indent}/**`, ...lines.map((l) => `${indent} * ${l}`.trimEnd()), `${indent} */`]
}
