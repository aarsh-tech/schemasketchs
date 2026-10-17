import { tableKey } from '@/lib/dbml/normalize'
import type { EnumModel, FieldModel, RefModel, SchemaModel, TableModel } from '@/lib/dbml/types'
import { dbmlName } from './dbml'
import type { ImportResult, Relation } from './shared'
import {
  claim,
  emptyModel,
  finishModel,
  isNowExpression,
  makeField,
  makeIndex,
  makeTable,
  parseType,
  primaryKey,
  readDefault,
  relationsOf,
  toIdentifier,
  writeDefault,
} from './shared'

/* Prisma schema ⇄ SchemaModel. Model and field names follow `prisma db pull`:
   they are the table and column names, with @map / @@map only when a name
   isn't a valid Prisma identifier. */

export type PrismaProvider = 'postgresql' | 'mysql' | 'sqlite'

type Scalar = 'String' | 'Int' | 'BigInt' | 'Float' | 'Decimal' | 'Boolean' | 'DateTime' | 'Json' | 'Bytes'
const SCALARS = new Set<string>(['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes'])

/** DBML type (parsed base) → Prisma scalar, plus the native type attribute for PostgreSQL and MySQL. */
const NATIVE: [string, Scalar, string | null, string | null][] = [
  ['text', 'String', 'Text', 'Text'],
  ['varchar', 'String', 'VarChar', 'VarChar'],
  ['char', 'String', 'Char', 'Char'],
  ['citext', 'String', 'Citext', null],
  ['uuid', 'String', 'Uuid', null],
  ['inet', 'String', 'Inet', null],
  ['xml', 'String', 'Xml', null],
  ['bit', 'String', 'Bit', null],
  ['varbit', 'String', 'VarBit', null],
  ['tinytext', 'String', null, 'TinyText'],
  ['mediumtext', 'String', null, 'MediumText'],
  ['longtext', 'String', null, 'LongText'],
  ['integer', 'Int', 'Integer', 'Int'],
  ['smallint', 'Int', 'SmallInt', 'SmallInt'],
  ['tinyint', 'Int', null, 'TinyInt'],
  ['mediumint', 'Int', null, 'MediumInt'],
  ['year', 'Int', null, 'Year'],
  ['oid', 'Int', 'Oid', null],
  ['serial', 'Int', 'Integer', 'Int'],
  ['bigint', 'BigInt', 'BigInt', 'BigInt'],
  ['bigserial', 'BigInt', 'BigInt', 'BigInt'],
  ['boolean', 'Boolean', 'Boolean', null],
  ['real', 'Float', 'Real', 'Float'],
  ['double precision', 'Float', 'DoublePrecision', 'Double'],
  ['double', 'Float', 'DoublePrecision', 'Double'],
  ['float', 'Float', 'DoublePrecision', 'Float'],
  ['decimal', 'Decimal', 'Decimal', 'Decimal'],
  ['numeric', 'Decimal', 'Decimal', 'Decimal'],
  ['money', 'Decimal', 'Money', null],
  ['timestamp', 'DateTime', 'Timestamp', 'Timestamp'],
  ['timestamptz', 'DateTime', 'Timestamptz', null],
  ['datetime', 'DateTime', null, 'DateTime'],
  ['date', 'DateTime', 'Date', 'Date'],
  ['time', 'DateTime', 'Time', 'Time'],
  ['timetz', 'DateTime', 'Timetz', null],
  ['json', 'Json', 'Json', 'Json'],
  ['jsonb', 'Json', 'JsonB', null],
  ['bytea', 'Bytes', 'ByteA', null],
  ['blob', 'Bytes', null, 'Blob'],
  ['tinyblob', 'Bytes', null, 'TinyBlob'],
  ['mediumblob', 'Bytes', null, 'MediumBlob'],
  ['longblob', 'Bytes', null, 'LongBlob'],
  ['binary', 'Bytes', null, 'Binary'],
  ['varbinary', 'Bytes', null, 'VarBinary'],
]
const NATIVE_BY_TYPE = new Map(NATIVE.map((n) => [n[0], n]))

/** The column type Prisma creates for a scalar without a native type attribute. */
const DEFAULT_TYPE: Record<PrismaProvider, Record<Scalar, string>> = {
  postgresql: { String: 'text', Int: 'integer', BigInt: 'bigint', Float: 'double precision', Decimal: 'decimal', Boolean: 'boolean', DateTime: 'timestamp', Json: 'jsonb', Bytes: 'bytea' },
  mysql: { String: 'varchar(191)', Int: 'int', BigInt: 'bigint', Float: 'double', Decimal: 'decimal', Boolean: 'boolean', DateTime: 'datetime', Json: 'json', Bytes: 'longblob' },
  sqlite: { String: 'text', Int: 'integer', BigInt: 'bigint', Float: 'real', Decimal: 'decimal', Boolean: 'boolean', DateTime: 'datetime', Json: 'json', Bytes: 'blob' },
}

const REFERENTIAL: Record<string, string> = { cascade: 'Cascade', 'set null': 'SetNull', restrict: 'Restrict', 'no action': 'NoAction', 'set default': 'SetDefault' }
const REFERENTIAL_BACK = Object.fromEntries(Object.entries(REFERENTIAL).map(([k, v]) => [v, k]))

const INDEX_TYPES: Record<string, string> = { btree: 'BTree', hash: 'Hash', gist: 'Gist', gin: 'Gin', spgist: 'SpGist', brin: 'Brin' }

const PROVIDER_NAME: Record<string, string> = { postgresql: 'PostgreSQL', postgres: 'PostgreSQL', cockroachdb: 'PostgreSQL', mysql: 'MySQL', sqlite: 'SQLite', sqlserver: 'SQL Server' }

export function providerFor(databaseType: string | null): PrismaProvider {
  const t = (databaseType ?? '').toLowerCase()
  if (t.includes('mysql') || t.includes('maria')) return 'mysql'
  if (t.includes('sqlite')) return 'sqlite'
  return 'postgresql'
}

const isPrismaIdentifier = (s: string) => /^[A-Za-z][A-Za-z0-9_]*$/.test(s)
const prismaString = (s: string) => JSON.stringify(s)

/* =====================================================================
   Export: SchemaModel → schema.prisma
   ===================================================================== */

interface Row {
  doc: string | null
  name: string
  type: string
  attrs: string[]
}

interface ModelOut {
  table: TableModel
  name: string
  rows: Row[]
  blockAttrs: string[]
  comments: string[]
  used: Set<string>
  /** column name → Prisma field name */
  fieldName: Map<string, string>
  ignored: boolean
}

function nativeAttr(type: string, provider: PrismaProvider): { scalar: string; attr: string | null; list: boolean } {
  const t = parseType(type)
  const entry = NATIVE_BY_TYPE.get(t.base)
  if (!entry || (t.array && provider !== 'postgresql')) return { scalar: `Unsupported(${prismaString(type)})`, attr: null, list: false }
  const [, scalar, pg, my] = entry
  const native = provider === 'postgresql' ? pg : provider === 'mysql' ? my : null
  // compared as written, so the type survives a round trip exactly
  const squash = (s: string) => s.toLowerCase().replace(/["\s]/g, '').replace(/\[\]$/, '')
  const isDefault = squash(type) === squash(DEFAULT_TYPE[provider][scalar])
  const attr = !native || isDefault ? null : `@db.${native}${t.args.length ? `(${t.args.join(', ')})` : ''}`
  return { scalar, attr, list: t.array }
}

function prismaDefault(f: FieldModel, scalar: string, enumValues: Map<string, string> | null): string | null {
  if (f.increment) return '@default(autoincrement())'
  const d = readDefault(f.defaultValue)
  if (!d || d.kind === 'null') return null
  if (enumValues && d.kind === 'string') {
    const v = enumValues.get(d.value)
    return v ? `@default(${v})` : null
  }
  switch (d.kind) {
    case 'string':
      return `@default(${prismaString(d.value)})`
    case 'number':
    case 'boolean':
      return `@default(${String(d.value)})`
    case 'expression': {
      if (scalar === 'DateTime' && isNowExpression(d.value)) return '@default(now())'
      if (/^(uuid|cuid|nanoid|ulid)\(\d*\)$/.test(d.value)) return `@default(${d.value})`
      return `@default(dbgenerated(${prismaString(d.value)}))`
    }
  }
}

export function toPrisma(model: SchemaModel, opts: { provider?: PrismaProvider } = {}): string {
  const provider = opts.provider ?? providerFor(model.databaseType)
  const global = new Set<string>([...SCALARS, 'Unsupported'])
  const schemas = new Set<string>()
  const multiSchema = provider === 'postgresql' && model.tables.some((t) => t.schema) // Prisma only supports schemas on PostgreSQL here

  /* enums */
  const enumOut = model.enums.map((e) => {
    const base = toIdentifier(e.name, isPrismaIdentifier, 'Enum')
    const name = claim(global.has(base) && e.schema ? toIdentifier(`${e.schema}_${e.name}`, isPrismaIdentifier, 'Enum') : base, global)
    const used = new Set<string>()
    const values = new Map<string, string>()
    for (const v of e.values) values.set(v, claim(toIdentifier(v, isPrismaIdentifier, 'v'), used))
    return { enum: e, name, values }
  })
  const enumFor = (f: FieldModel) => {
    if (!f.enumName) return null
    const schema = f.type.includes('.') ? f.type.split('.')[0].replace(/"/g, '') : null
    return enumOut.find((x) => x.enum.name === f.enumName && (x.enum.schema ?? null) === (schema === 'public' ? null : schema)) ?? enumOut.find((x) => x.enum.name === f.enumName) ?? null
  }

  /* models and their columns */
  const models = new Map<string, ModelOut>()
  for (const t of model.tables) {
    const base = toIdentifier(t.name, isPrismaIdentifier, 'Model')
    const name = claim(global.has(base) && t.schema ? toIdentifier(`${t.schema}_${t.name}`, isPrismaIdentifier, 'Model') : base, global)
    const m: ModelOut = { table: t, name, rows: [], blockAttrs: [], comments: [], used: new Set(), fieldName: new Map(), ignored: false }
    models.set(t.id, m)
    const pk = primaryKey(t)
    const compositePk = pk.length > 1

    for (const f of t.fields) {
      const fname = claim(toIdentifier(f.name, isPrismaIdentifier, 'field'), m.used)
      m.fieldName.set(f.name, fname)
      const en = enumFor(f)
      const attrs: string[] = []
      let type: string
      let list = false
      let native: string | null = null
      if (en) type = en.name
      else {
        const n = nativeAttr(f.type, provider)
        type = n.scalar
        list = n.list
        native = n.attr
      }
      const inPk = pk.includes(f.name)
      if (inPk && !compositePk) attrs.push('@id')
      const def = prismaDefault(f, type, en?.values ?? null)
      if (def) attrs.push(def)
      if (f.unique && !(inPk && !compositePk)) attrs.push('@unique')
      if (native) attrs.push(native)
      if (fname !== f.name) attrs.push(`@map(${prismaString(f.name)})`)
      const optional = !f.notNull && !inPk && !list
      m.rows.push({ doc: f.note, name: fname, type: `${type}${list ? '[]' : optional ? '?' : ''}`, attrs })
    }

    const cols = (names: string[]) => `[${names.map((c) => m.fieldName.get(c) ?? c).join(', ')}]`
    const pkIndex = t.indexes.find((i) => i.pk)
    if (compositePk) m.blockAttrs.push(`@@id(${cols(pk)}${pkIndex?.name && provider === 'postgresql' ? `, map: ${prismaString(pkIndex.name)}` : ''})`)
    for (const i of t.indexes) {
      if (i.pk) continue
      if (i.columns.some((c) => c.startsWith('`'))) {
        m.comments.push(`// Prisma can't express an index on an expression: (${i.columns.join(', ')})`)
        continue
      }
      const extra: string[] = []
      if (i.name) extra.push(`map: ${prismaString(i.name)}`)
      const type = i.type ? INDEX_TYPES[i.type.toLowerCase()] : null
      if (type && provider === 'postgresql' && !i.unique) extra.push(`type: ${type}`)
      m.blockAttrs.push(`${i.unique ? '@@unique' : '@@index'}(${[cols(i.columns), ...extra].join(', ')})`)
    }
    if (name !== t.name) m.blockAttrs.push(`@@map(${prismaString(t.name)})`)
    if (multiSchema) {
      const s = t.schema ?? 'public'
      schemas.add(s)
      m.blockAttrs.push(`@@schema(${prismaString(s)})`)
    }
    const hasUnique = pk.length > 0 || t.fields.some((f) => f.unique) || t.indexes.some((i) => i.unique && !i.columns.some((c) => c.startsWith('`')))
    if (!hasUnique) {
      m.ignored = true
      m.comments.push('// This table has no primary key or unique column, so Prisma Client ignores it.')
      m.blockAttrs.push('@@ignore')
    }
  }

  /* relations */
  const rels = relationsOf(model)
  const pairCount = new Map<string, number>()
  const pairKey = (a: string, b: string) => [a, b].sort().join('\0')
  for (const r of rels) pairCount.set(pairKey(r.child.tableId, r.parent.tableId), (pairCount.get(pairKey(r.child.tableId, r.parent.tableId)) ?? 0) + 1)

  for (const r of rels) addRelation(r)

  function addRelation({ ref, kind, child, parent }: Relation) {
    const cm = models.get(child.tableId)
    const pm = models.get(parent.tableId)
    if (!cm || !pm) return
    const self = cm === pm
    const needsName = self || (pairCount.get(pairKey(child.tableId, parent.tableId)) ?? 0) > 1
    const relName = needsName ? prismaString(`${cm.table.name}_${child.fields.join('_')}`) : null
    const ignoreAttr = (target: ModelOut) => (target.ignored ? ['@ignore'] : [])

    if (kind === 'many-to-many') {
      if (primaryKey(cm.table).length !== 1 || primaryKey(pm.table).length !== 1) {
        cm.comments.push(`// Prisma's many-to-many relations need a single-column primary key on both sides: ${cm.table.name} <> ${pm.table.name}`)
        return
      }
      const nameAttr = relName ? [`@relation(${relName})`] : []
      cm.rows.push({ doc: null, name: claim(pm.name, cm.used), type: `${pm.name}[]`, attrs: [...nameAttr, ...ignoreAttr(pm)] })
      if (!self) pm.rows.push({ doc: null, name: claim(cm.name, pm.used), type: `${cm.name}[]`, attrs: [...nameAttr, ...ignoreAttr(cm)] })
      else cm.rows.push({ doc: null, name: claim(`${cm.name}_of`, cm.used), type: `${cm.name}[]`, attrs: nameAttr })
      return
    }

    // the field holding the relation on the child: customer_id → customer
    const stripped = child.fields.length === 1 ? child.fields[0].replace(/(_id|Id|_ID|ID)$/, '') : ''
    const relField = claim(stripped && stripped !== child.fields[0] && !cm.used.has(stripped) && isPrismaIdentifier(stripped) ? stripped : pm.name, cm.used)
    const optional = child.fields.some((c) => {
      const f = cm.table.fields.find((x) => x.name === c)
      return !!f && !f.notNull && !primaryKey(cm.table).includes(c)
    })
    const args = [
      ...(relName ? [relName] : []),
      `fields: [${child.fields.map((c) => cm.fieldName.get(c) ?? c).join(', ')}]`,
      `references: [${parent.fields.map((c) => pm.fieldName.get(c) ?? c).join(', ')}]`,
      ...(ref.onDelete && REFERENTIAL[ref.onDelete.toLowerCase()] ? [`onDelete: ${REFERENTIAL[ref.onDelete.toLowerCase()]}`] : []),
      ...(ref.onUpdate && REFERENTIAL[ref.onUpdate.toLowerCase()] ? [`onUpdate: ${REFERENTIAL[ref.onUpdate.toLowerCase()]}`] : []),
      ...(ref.name && provider !== 'sqlite' ? [`map: ${prismaString(ref.name)}`] : []),
    ]
    cm.rows.push({ doc: null, name: relField, type: `${pm.name}${optional ? '?' : ''}`, attrs: [`@relation(${args.join(', ')})`, ...ignoreAttr(pm)] })

    if (kind === 'one-to-one') {
      // Prisma needs the foreign key of a one-to-one relation to be unique
      const fk = child.fields.map((c) => cm.fieldName.get(c) ?? c)
      const unique = child.fields.length === 1 ? cm.table.fields.find((f) => f.name === child.fields[0])?.unique : cm.table.indexes.some((i) => i.unique && i.columns.join() === child.fields.join())
      if (!unique) {
        if (fk.length === 1) cm.rows.find((row) => row.name === fk[0])?.attrs.push('@unique')
        else cm.blockAttrs.unshift(`@@unique([${fk.join(', ')}])`)
      }
    }
    const back = needsName ? `${cm.name}_${relField}` : cm.name
    pm.rows.push({
      doc: null,
      name: claim(back, pm.used),
      type: kind === 'one-to-one' ? `${cm.name}?` : `${cm.name}[]`,
      attrs: [...(relName ? [`@relation(${relName})`] : []), ...ignoreAttr(cm)],
    })
  }

  /* print */
  const out: string[] = [
    '// Generated by Schemasketch. With Prisma 7 the connection URL goes in prisma.config.ts.',
    '',
    'generator client {',
    '  provider = "prisma-client"',
    '  output   = "../src/generated/prisma"',
    '}',
    '',
    'datasource db {',
    `  provider = ${prismaString(provider)}`,
    ...(multiSchema ? [`  schemas  = [${[...schemas].sort().map(prismaString).join(', ')}]`] : []),
    '}',
  ]

  for (const e of enumOut) {
    const lines = ['', `enum ${e.name} {`]
    const pad = Math.max(0, ...[...e.values.values()].map((v) => v.length))
    for (const [orig, v] of e.values) lines.push(`  ${v === orig ? v : `${v.padEnd(pad)} @map(${prismaString(orig)})`}`)
    const attrs: string[] = []
    if (e.name !== e.enum.name) attrs.push(`@@map(${prismaString(e.enum.name)})`)
    if (multiSchema) attrs.push(`@@schema(${prismaString(e.enum.schema ?? 'public')})`)
    if (attrs.length) lines.push('', ...attrs.map((a) => `  ${a}`))
    lines.push('}')
    out.push(...lines)
  }

  for (const m of models.values()) {
    out.push('', ...docLines(m.table.note, ''), `model ${m.name} {`)
    const nameW = Math.max(...m.rows.map((r) => r.name.length))
    const typeW = Math.max(...m.rows.map((r) => r.type.length))
    for (const r of m.rows) {
      out.push(...docLines(r.doc, '  '))
      out.push(`  ${r.name.padEnd(nameW)} ${r.attrs.length ? `${r.type.padEnd(typeW)} ${r.attrs.join(' ')}` : r.type}`.trimEnd())
    }
    if (m.blockAttrs.length || m.comments.length) out.push('')
    for (const c of m.comments) out.push(`  ${c}`)
    for (const a of m.blockAttrs) out.push(`  ${a}`)
    out.push('}')
  }
  const dangling = rels.filter((r) => !models.get(r.child.tableId) || !models.get(r.parent.tableId))
  if (dangling.length) out.push('', `// ${dangling.length} relationship(s) point at tables that don't exist and were left out.`)
  return `${out.join('\n')}\n`
}

const docLines = (note: string | null, indent: string) => (note?.trim() ? note.trim().split('\n').map((l) => `${indent}/// ${l}`.trimEnd()) : [])

/* =====================================================================
   Import: schema.prisma → SchemaModel
   ===================================================================== */

type TokKind = 'id' | 'str' | 'num' | 'p' | 'nl' | 'doc'
interface Tok {
  k: TokKind
  v: string
  line: number
}

function lex(text: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  let line = 1
  const push = (k: TokKind, v: string) => toks.push({ k, v, line })
  while (i < text.length) {
    const c = text[i]
    if (c === '\n') {
      push('nl', '\n')
      line++
      i++
    } else if (/\s/.test(c)) i++
    else if (text.startsWith('///', i)) {
      const end = text.indexOf('\n', i)
      const stop = end < 0 ? text.length : end
      push('doc', text.slice(i + 3, stop).trim())
      i = stop
    } else if (text.startsWith('//', i)) {
      const end = text.indexOf('\n', i)
      i = end < 0 ? text.length : end
    } else if (c === '"') {
      let j = i + 1
      let s = ''
      while (j < text.length && text[j] !== '"' && text[j] !== '\n') {
        if (text[j] === '\\' && j + 1 < text.length) {
          const n = text[j + 1]
          s += n === 'n' ? '\n' : n === 't' ? '\t' : n
          j += 2
        } else s += text[j++]
      }
      push('str', s)
      i = j + 1
    } else if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(text[i + 1] ?? ''))) {
      const m = /^-?\d+(\.\d+)?/.exec(text.slice(i))!
      push('num', m[0])
      i += m[0].length
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][\w]*/.exec(text.slice(i))!
      push('id', m[0])
      i += m[0].length
    } else {
      push('p', c)
      i++
    }
  }
  return toks
}

type PValue = { k: 'str'; v: string } | { k: 'num'; v: string } | { k: 'id'; v: string } | { k: 'list'; items: PValue[] } | { k: 'call'; name: string; args: PArg[] }
interface PArg {
  name: string | null
  value: PValue
}
interface PAttr {
  name: string
  args: PArg[]
}
interface PField {
  name: string
  type: string
  /** argument of Unsupported("…") */
  unsupported: string | null
  list: boolean
  optional: boolean
  attrs: PAttr[]
  doc: string | null
}
interface PBlock {
  kind: string
  name: string
  doc: string | null
  fields: PField[]
  blockAttrs: PAttr[]
  /** key = value lines (datasource, generator) */
  settings: Map<string, PValue>
}

class Cursor {
  toks: Tok[]
  i = 0
  constructor(toks: Tok[]) {
    this.toks = toks
  }
  get t(): Tok | undefined {
    return this.toks[this.i]
  }
  is(v: string, k: TokKind = 'p') {
    return this.t?.k === k && this.t.v === v
  }
  eat(v: string, k: TokKind = 'p') {
    if (this.is(v, k)) {
      this.i++
      return true
    }
    return false
  }
  /** an error pointing at the current line */
  fail(message: string) {
    const line = this.t?.line ?? this.toks[this.toks.length - 1]?.line ?? 1
    return new Error(`Line ${line}: ${message}`)
  }
}

function parseValue(c: Cursor): PValue {
  const t = c.t
  if (!t) throw c.fail('The file ended in the middle of a value.')
  if (t.k === 'str' || t.k === 'num') {
    c.i++
    return { k: t.k, v: t.v }
  }
  if (c.eat('[')) {
    const items: PValue[] = []
    while (c.t && !c.is(']')) {
      items.push(parseValue(c))
      c.eat(',')
    }
    c.eat(']')
    return { k: 'list', items }
  }
  if (t.k === 'id') {
    c.i++
    let name = t.v
    while (c.is('.') && c.toks[c.i + 1]?.k === 'id') {
      name += `.${c.toks[c.i + 1].v}`
      c.i += 2
    }
    if (c.eat('(')) return { k: 'call', name, args: parseArgs(c) }
    return { k: 'id', v: name }
  }
  throw c.fail(`Expected a value but found “${t.v}”. Check for a missing ) or ] before it.`)
}

/** Arguments after "(" up to and including ")". */
function parseArgs(c: Cursor): PArg[] {
  const args: PArg[] = []
  while (c.t && !c.is(')')) {
    if (c.t.k === 'nl') {
      c.i++
      continue
    }
    if (c.t.k === 'id' && c.toks[c.i + 1]?.v === ':' && c.toks[c.i + 1]?.k === 'p') {
      const name = c.t.v
      c.i += 2
      args.push({ name, value: parseValue(c) })
    } else args.push({ name: null, value: parseValue(c) })
    if (!c.eat(',') && !c.is(')')) throw c.fail(`Expected “,” or “)” but found “${c.t?.v ?? 'the end of the file'}”.`)
  }
  c.eat(')')
  return args
}

function parseAttr(c: Cursor): PAttr {
  // "@" or "@@" already consumed
  let name = c.t?.k === 'id' ? c.t.v : ''
  c.i++
  while (c.is('.') && c.toks[c.i + 1]?.k === 'id') {
    name += `.${c.toks[c.i + 1].v}`
    c.i += 2
  }
  return { name, args: c.eat('(') ? parseArgs(c) : [] }
}

function parseBlocks(text: string): PBlock[] {
  const c = new Cursor(lex(text))
  const blocks: PBlock[] = []
  let doc: string[] = []
  while (c.t) {
    const t = c.t
    if (t.k === 'nl') {
      c.i++
      continue
    }
    if (t.k === 'doc') {
      doc.push(t.v)
      c.i++
      continue
    }
    if (t.k === 'id' && c.toks[c.i + 1]?.k === 'id' && c.toks[c.i + 2]?.v === '{') {
      c.i += 3
      blocks.push(parseBody(c, t.v, c.toks[c.i - 2].v, doc.length ? doc.join('\n') : null))
      doc = []
      continue
    }
    throw c.fail(`Expected a model, enum, datasource or generator block but found “${t.v}”.`)
  }
  return blocks
}

function parseBody(c: Cursor, kind: string, name: string, doc: string | null): PBlock {
  const block: PBlock = { kind, name, doc, fields: [], blockAttrs: [], settings: new Map() }
  let docs: string[] = []
  while (c.t && !c.is('}')) {
    const t = c.t
    if (t.k === 'nl') {
      c.i++
      continue
    }
    if (t.k === 'doc') {
      docs.push(t.v)
      c.i++
      continue
    }
    if (c.is('@') && c.toks[c.i + 1]?.v === '@') {
      c.i += 2
      block.blockAttrs.push(parseAttr(c))
      continue
    }
    if (t.k !== 'id') throw c.fail(`Unexpected “${t.v}” in ${kind} ${name}.`)
    c.i++
    if (c.eat('=')) {
      block.settings.set(t.v, parseValue(c))
      continue
    }
    const field: PField = { name: t.v, type: '', unsupported: null, list: false, optional: false, attrs: [], doc: docs.length ? docs.join('\n') : null }
    docs = []
    if (kind !== 'enum') {
      if (c.t?.k !== 'id') throw c.fail(`The field ${name}.${t.v} has no type.`)
      field.type = c.t.v
      c.i++
      if (field.type === 'Unsupported' && c.eat('(')) {
        const args = parseArgs(c)
        field.unsupported = args[0]?.value.k === 'str' ? args[0].value.v : 'unknown'
      }
      if (c.eat('[')) {
        c.eat(']')
        field.list = true
      }
      if (c.eat('?')) field.optional = true
    }
    while (c.eat('@')) field.attrs.push(parseAttr(c))
    if (c.t && c.t.k !== 'nl' && !c.is('}')) throw c.fail(`Unexpected “${c.t.v}” after ${name}.${field.name}.`)
    block.fields.push(field)
  }
  c.eat('}')
  return block
}

const attr = (list: PAttr[], name: string) => list.find((a) => a.name === name)
const arg = (a: PAttr | undefined, name: string, position = 0): PValue | undefined => a?.args.find((x) => x.name === name)?.value ?? (position >= 0 ? a?.args.filter((x) => !x.name)[position]?.value : undefined)
const str = (v: PValue | undefined) => (v?.k === 'str' ? v.v : null)
/** the field names in [a, b(sort: Desc)] */
const names = (v: PValue | undefined) => (v?.k === 'list' ? v.items.map((x) => (x.k === 'id' ? x.v : x.k === 'call' ? x.name : null)).filter((x): x is string => !!x) : [])

export function fromPrisma(text: string): ImportResult {
  const blocks = parseBlocks(text)
  const warnings: string[] = []
  const model = emptyModel()

  const datasource = blocks.find((b) => b.kind === 'datasource')
  const providerValue = str(datasource?.settings.get('provider'))
  const provider: PrismaProvider = providerValue === 'mysql' ? 'mysql' : providerValue === 'sqlite' ? 'sqlite' : 'postgresql'
  if (providerValue) model.databaseType = PROVIDER_NAME[providerValue] ?? providerValue
  if (providerValue === 'mongodb') warnings.push('This is a MongoDB schema; collections were read as tables.')

  const schemaOf = (b: PBlock) => {
    const s = str(arg(attr(b.blockAttrs, 'schema'), 'name'))
    return s && s !== 'public' ? s : null
  }

  /* enums */
  const enums = new Map<string, { model: EnumModel; values: Map<string, string> }>()
  for (const b of blocks.filter((x) => x.kind === 'enum')) {
    const name = str(arg(attr(b.blockAttrs, 'map'), 'name')) ?? b.name
    const schema = schemaOf(b)
    const values = new Map(b.fields.map((f) => [f.name, str(arg(attr(f.attrs, 'map'), 'name')) ?? f.name]))
    const e: EnumModel = { id: tableKey(schema, name), name, schema, values: [...values.values()] }
    model.enums.push(e)
    enums.set(b.name, { model: e, values })
  }

  const modelBlocks = blocks.filter((b) => b.kind === 'model')
  for (const b of blocks) if (b.kind === 'view' || b.kind === 'type') warnings.push(`Left out ${b.kind} ${b.name}: only models become tables.`)
  const byName = new Map(modelBlocks.map((b) => [b.name, b]))

  /* tables */
  const tables = new Map<string, { table: TableModel; column: Map<string, string> }>()
  for (const b of modelBlocks) {
    const table = makeTable(str(arg(attr(b.blockAttrs, 'map'), 'name')) ?? b.name, schemaOf(b), { note: b.doc })
    const column = new Map<string, string>()
    tables.set(b.name, { table, column })
    const compositeId = attr(b.blockAttrs, 'id')
    const compositeCols = new Set(names(arg(compositeId, 'fields')))

    for (const f of b.fields) {
      if (byName.has(f.type)) continue // relation field
      const colName = str(arg(attr(f.attrs, 'map'), 'name')) ?? f.name
      column.set(f.name, colName)
      const en = enums.get(f.type)
      let type: string
      if (en) type = en.model.schema ? `${dbmlName(en.model.schema)}.${dbmlName(en.model.name)}` : dbmlName(en.model.name)
      else if (f.unsupported) type = f.unsupported
      else if (SCALARS.has(f.type)) {
        const native = f.attrs.find((a) => a.name.startsWith('db.'))
        type = native ? nativeToDbml(native, provider) : DEFAULT_TYPE[provider][f.type as Scalar]
      } else {
        warnings.push(`${b.name}.${f.name} has the unknown type ${f.type}; it was imported as text.`)
        type = 'text'
      }
      if (f.list) type = `${type}[]`
      const pk = !!attr(f.attrs, 'id')
      const field = makeField(colName, type, {
        pk,
        unique: !!attr(f.attrs, 'unique'),
        notNull: !f.optional && !f.list && !pk && !compositeCols.has(f.name),
        enumName: en ? en.model.name : null,
        note: f.doc,
      })
      const def = arg(attr(f.attrs, 'default'), 'value')
      if (def) applyDefault(field, def, en?.values ?? null, `${b.name}.${f.name}`, warnings)
      table.fields.push(field)
    }

    const cols = (v: PValue | undefined) => names(v).map((n) => column.get(n) ?? n)
    if (compositeId) table.indexes.push(makeIndex(cols(arg(compositeId, 'fields')), { pk: true, name: str(arg(compositeId, 'map', -1)) }))
    for (const a of b.blockAttrs) {
      if (a.name !== 'unique' && a.name !== 'index') continue
      const type = arg(a, 'type', -1)
      table.indexes.push(
        makeIndex(cols(arg(a, 'fields')), {
          unique: a.name === 'unique',
          name: str(arg(a, 'map', -1)),
          type: type?.k === 'id' ? type.v.toLowerCase() : null,
        }),
      )
    }
    model.tables.push(table)
  }

  /* relations */
  const seenManyToMany = new Set<string>()
  for (const b of modelBlocks) {
    const child = tables.get(b.name)!
    for (const f of b.fields) {
      const target = byName.get(f.type)
      if (!target) continue
      const parent = tables.get(target.name)!
      const rel = attr(f.attrs, 'relation')
      const relName = str(arg(rel, 'name'))
      const fields = names(arg(rel, 'fields', -1))
      // the field on the other model that pairs with this one
      const opposite = target.fields.find((o) => o.type === b.name && o !== f && str(arg(attr(o.attrs, 'relation'), 'name')) === relName)

      if (fields.length) {
        const references = names(arg(rel, 'references', -1))
        const action = (key: string) => {
          const v = arg(rel, key, -1)
          return v?.k === 'id' ? (REFERENTIAL_BACK[v.v] ?? null) : null
        }
        const oneToOne = !!opposite && !opposite.list
        model.refs.push(ref(model.refs.length, str(arg(rel, 'map', -1)), {
          source: { tableId: child.table.id, fields: fields.map((n) => child.column.get(n) ?? n), cardinality: oneToOne ? 'one' : 'many' },
          target: { tableId: parent.table.id, fields: references.map((n) => parent.column.get(n) ?? n), cardinality: 'one' },
          onDelete: action('onDelete'),
          onUpdate: action('onUpdate'),
        }))
      } else if (f.list && opposite?.list) {
        // implicit many-to-many: relate the two primary keys
        const key = [b.name, target.name].sort().join('\0') + `\0${relName ?? ''}`
        if (seenManyToMany.has(key)) continue
        seenManyToMany.add(key)
        const pkA = primaryKey(child.table)
        const pkB = primaryKey(parent.table)
        if (pkA.length !== 1 || pkB.length !== 1) {
          warnings.push(`Left out the many-to-many relation between ${b.name} and ${target.name}: both need a single-column @id.`)
          continue
        }
        model.refs.push(ref(model.refs.length, null, {
          source: { tableId: child.table.id, fields: pkA, cardinality: 'many' },
          target: { tableId: parent.table.id, fields: pkB, cardinality: 'many' },
          onDelete: null,
          onUpdate: null,
        }))
      } else if (!opposite) {
        warnings.push(`${b.name}.${f.name} has no matching relation field on ${target.name}.`)
      }
    }
  }

  if (!model.tables.length && !model.enums.length) throw new Error('No models or enums found. Paste the contents of a schema.prisma file.')
  return { model: finishModel(model), warnings }
}

const ref = (n: number, name: string | null, r: Omit<RefModel, 'id' | 'name'>): RefModel => ({ id: `ref:${n + 1}`, name, ...r })

function nativeToDbml(a: PAttr, provider: PrismaProvider): string {
  const native = a.name.slice(3)
  const column = provider === 'mysql' ? 3 : 2
  const entry = NATIVE.find((n) => n[column] === native) ?? NATIVE.find((n) => n[2] === native || n[3] === native)
  const base = entry ? entry[0] : native.toLowerCase()
  const args = a.args.map((x) => (x.value.k === 'str' || x.value.k === 'num' || x.value.k === 'id' ? x.value.v : '')).filter(Boolean)
  return args.length ? `${base}(${args.join(',')})` : base
}

function applyDefault(field: FieldModel, v: PValue, enumValues: Map<string, string> | null, where: string, warnings: string[]) {
  if (v.k === 'str') field.defaultValue = writeDefault({ kind: 'string', value: v.v })
  else if (v.k === 'num') field.defaultValue = v.v
  else if (v.k === 'id') {
    if (v.v === 'true' || v.v === 'false') field.defaultValue = v.v
    else if (enumValues?.has(v.v)) field.defaultValue = writeDefault({ kind: 'string', value: enumValues.get(v.v)! })
    else warnings.push(`${where}: left out the default ${v.v}.`)
  } else if (v.k === 'call') {
    if (v.name === 'autoincrement' || v.name === 'sequence') field.increment = true
    else if (v.name === 'dbgenerated') {
      const expr = v.args[0]?.value
      if (expr?.k === 'str') field.defaultValue = writeDefault({ kind: 'expression', value: expr.v })
    } else {
      const args = v.args.map((x) => (x.value.k === 'num' || x.value.k === 'str' ? x.value.v : '')).join(', ')
      field.defaultValue = writeDefault({ kind: 'expression', value: `${v.name}(${args})` })
    }
  } else warnings.push(`${where}: left out a list default.`)
}
