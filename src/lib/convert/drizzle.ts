import type { FieldModel, IndexModel, RefModel, SchemaModel, TableModel } from '@/lib/dbml/types'
import { dbmlName } from './dbml'
import { flattenChain, prop, readDeclarations, strValue } from './js'
import type { JsNode } from './js'
import type { ImportResult } from './shared'
import {
  camel,
  claim,
  emptyModel,
  finishModel,
  isJsIdentifier,
  isNowExpression,
  jsDoc,
  jsKey,
  jsString,
  makeField,
  makeIndex,
  makeTable,
  parseType,
  primaryKey,
  readDefault,
  relationsOf,
  typeKind,
  writeDefault,
} from './shared'

/* Drizzle ORM schema files (pg-core, mysql-core, sqlite-core) ⇄ SchemaModel. */

export type DrizzleDialect = 'postgres' | 'mysql'
type ReadDialect = DrizzleDialect | 'sqlite'

export const drizzleDialectFor = (databaseType: string | null): DrizzleDialect => (/mysql|maria/i.test(databaseType ?? '') ? 'mysql' : 'postgres')

/* =====================================================================
   Export: SchemaModel → schema.ts
   ===================================================================== */

interface Builder {
  fn: string
  /** the config object, e.g. "{ length: 255 }" */
  config: string | null
}

const num = (s: string | undefined) => (s && /^\d+$/.test(s) ? s : null)
const cfg = (entries: [string, string | null][]) => {
  const parts = entries.filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`)
  return parts.length ? `{ ${parts.join(', ')} }` : null
}

function pgBuilder(type: string, increment: boolean): Builder | null {
  const { base, args } = parseType(type)
  const [a, b] = args
  switch (base) {
    case 'integer':
      return { fn: increment ? 'serial' : 'integer', config: null }
    case 'smallint':
      return { fn: increment ? 'smallserial' : 'smallint', config: null }
    case 'bigint':
      return { fn: increment ? 'bigserial' : 'bigint', config: "{ mode: 'number' }" }
    case 'serial':
    case 'smallserial':
      return { fn: base, config: null }
    case 'bigserial':
      return { fn: 'bigserial', config: "{ mode: 'number' }" }
    case 'boolean':
    case 'text':
    case 'uuid':
    case 'date':
    case 'json':
    case 'jsonb':
    case 'real':
    case 'interval':
    case 'inet':
    case 'cidr':
    case 'macaddr':
    case 'macaddr8':
    case 'point':
    case 'line':
      return { fn: base, config: null }
    case 'double precision':
      return { fn: 'doublePrecision', config: null }
    case 'varchar':
    case 'char':
      return { fn: base, config: cfg([['length', num(a)]]) }
    case 'decimal':
    case 'numeric':
      return { fn: base, config: cfg([['precision', num(a)], ['scale', num(b)]]) }
    case 'timestamp':
    case 'timestamptz':
      return { fn: 'timestamp', config: cfg([['withTimezone', base === 'timestamptz' ? 'true' : null], ['precision', num(a)]]) }
    case 'time':
    case 'timetz':
      return { fn: 'time', config: cfg([['withTimezone', base === 'timetz' ? 'true' : null], ['precision', num(a)]]) }
    case 'vector':
      return num(a) ? { fn: 'vector', config: `{ dimensions: ${a} }` } : null
    default:
      return null
  }
}

function mysqlBuilder(type: string): Builder | null {
  const { base, args } = parseType(type)
  const [a, b] = args
  switch (base) {
    case 'integer':
      return { fn: 'int', config: null }
    case 'bigint':
      return { fn: 'bigint', config: "{ mode: 'number' }" }
    case 'tinyint':
    case 'smallint':
    case 'mediumint':
    case 'serial':
    case 'boolean':
    case 'text':
    case 'tinytext':
    case 'mediumtext':
    case 'longtext':
    case 'json':
    case 'date':
    case 'year':
    case 'real':
    case 'float':
      return { fn: base, config: null }
    case 'double':
    case 'double precision':
      return { fn: 'double', config: null }
    case 'varchar':
      return { fn: 'varchar', config: `{ length: ${num(a) ?? '255'} }` }
    case 'char':
    case 'binary':
    case 'varbinary':
      return { fn: base, config: cfg([['length', num(a)]]) ?? (base === 'varbinary' ? '{ length: 255 }' : null) }
    case 'decimal':
    case 'numeric':
      return { fn: 'decimal', config: cfg([['precision', num(a)], ['scale', num(b)]]) }
    case 'datetime':
    case 'timestamp':
    case 'time':
      return { fn: base, config: cfg([['fsp', num(a)]]) }
    default:
      return null
  }
}

const TS_DATA: Record<string, string> = { int: 'number', bigint: 'number', float: 'number', decimal: 'string', bool: 'boolean', date: 'Date', datetime: 'Date', json: 'unknown', bytes: 'Buffer' }

const ACTIONS = new Set(['cascade', 'set null', 'restrict', 'no action', 'set default'])

export function toDrizzle(model: SchemaModel, opts: { dialect?: DrizzleDialect } = {}): string {
  const dialect = opts.dialect ?? drizzleDialectFor(model.databaseType)
  const pg = dialect === 'postgres'
  const core = pg ? 'pg' : 'mysql'
  const imports = new Set<string>()
  const imp = (name: string) => {
    imports.add(name)
    return name
  }
  let usesSql = false
  let selfRef = false
  const notes: string[] = []

  // every builder we might import is off-limits as a variable name
  const taken = new Set<string>([
    'sql', 'pgTable', 'pgEnum', 'pgSchema', 'mysqlTable', 'mysqlEnum', 'mysqlSchema', 'customType', 'index', 'uniqueIndex', 'primaryKey', 'foreignKey', 'unique',
    'integer', 'int', 'smallint', 'bigint', 'serial', 'smallserial', 'bigserial', 'boolean', 'text', 'uuid', 'date', 'json', 'jsonb', 'real', 'interval', 'inet', 'cidr',
    'macaddr', 'macaddr8', 'point', 'line', 'doublePrecision', 'double', 'float', 'varchar', 'char', 'decimal', 'numeric', 'timestamp', 'time', 'vector', 'tinyint',
    'mediumint', 'tinytext', 'mediumtext', 'longtext', 'year', 'binary', 'varbinary', 'datetime',
  ])
  const varName = (base: string, suffix: string) => {
    const c = camel(base) || suffix.toLowerCase()
    return claim(isJsIdentifier(c) && !taken.has(c) ? c : `${c}${suffix}`, taken)
  }

  /* schemas */
  const schemaVar = new Map<string, string>()
  const schemaFor = (schema: string | null) => {
    if (!schema) return null
    let v = schemaVar.get(schema)
    if (!v) {
      v = varName(`${schema}_schema`, 'Schema')
      schemaVar.set(schema, v)
      imp(pg ? 'pgSchema' : 'mysqlSchema')
    }
    return v
  }

  /* enums */
  const enumDecl: string[] = []
  const enumVar = new Map<string, string>()
  for (const e of model.enums) {
    const values = `[${e.values.map(jsString).join(', ')}]`
    if (pg) {
      const v = varName(e.name, 'Enum')
      const s = schemaFor(e.schema)
      enumDecl.push(`export const ${v} = ${s ? `${s}.enum` : imp('pgEnum')}(${jsString(e.name)}, ${values})`)
      enumVar.set(e.name, v)
    } else {
      // MySQL enums are declared per column; keep the values (and the name) in a shared constant
      const v = isJsIdentifier(e.name) && !taken.has(e.name) ? claim(e.name, taken) : varName(e.name, 'Values')
      enumDecl.push(`export const ${v} = ${values} as const`)
      enumVar.set(e.name, v)
    }
  }

  /* custom types for anything the dialect has no builder for */
  const customDecl: string[] = []
  const customVar = new Map<string, string>()
  const custom = (type: string) => {
    let v = customVar.get(type)
    if (!v) {
      v = varName(type, 'Type')
      customVar.set(type, v)
      const data = TS_DATA[typeKind(parseType(type).base)] ?? 'string'
      customDecl.push(`const ${v} = ${imp('customType')}<{ data: ${data} }>({ dataType: () => ${jsString(type)} })`)
    }
    return v
  }

  /* table and column names */
  const tableVar = new Map<string, string>()
  const colKey = new Map<string, Map<string, string>>()
  for (const t of model.tables) {
    tableVar.set(t.id, varName(t.schema ? `${t.schema}_${t.name}` : t.name, 'Table'))
    const used = new Set<string>()
    colKey.set(t.id, new Map(t.fields.map((f) => [f.name, claim(camel(f.name) || 'column', used)])))
  }
  const access = (object: string, key: string) => (/^[A-Za-z_$][\w$]*$/.test(key) ? `${object}.${key}` : `${object}[${jsString(key)}]`)
  const keyOf = (tableId: string, col: string) => colKey.get(tableId)?.get(col) ?? camel(col)
  const ref = (tableId: string, col: string) => access(tableVar.get(tableId)!, keyOf(tableId, col))
  const cols = (tableId: string, names: string[]) => names.map((c) => (c.startsWith('`') ? `sql\`${c.slice(1, -1)}\`` : access('t', keyOf(tableId, c))))

  /* relationships: single-column ones go on the column, the rest in the table's extras */
  const inline = new Map<string, string>()
  const extraFks = new Map<string, string[]>()
  for (const r of relationsOf(model)) {
    const { ref: rr, kind, child, parent } = r
    if (kind === 'many-to-many') {
      notes.push(`Drizzle has no many-to-many column type, so ${child.tableId}.${child.fields.join(', ')} <> ${parent.tableId}.${parent.fields.join(', ')} was left out. Add a join table.`)
      continue
    }
    if (!tableVar.has(child.tableId) || !tableVar.has(parent.tableId)) continue
    const actions = [
      ['onDelete', rr.onDelete],
      ['onUpdate', rr.onUpdate],
    ].filter(([, v]) => v && ACTIONS.has(v.toLowerCase())) as [string, string][]
    if (child.fields.length === 1 && !rr.name) {
      const self = child.tableId === parent.tableId
      if (self) selfRef = true
      const target = `${self ? `(): Any${pg ? 'Pg' : 'MySql'}Column` : '()'} => ${ref(parent.tableId, parent.fields[0])}`
      const opts = actions.length ? `, { ${actions.map(([k, v]) => `${k}: ${jsString(v.toLowerCase())}`).join(', ')} }` : ''
      inline.set(`${child.tableId}\0${child.fields[0]}`, `.references(${target}${opts})`)
    } else {
      const fk = [
        ...(rr.name ? [`name: ${jsString(rr.name)}`] : []),
        `columns: [${cols(child.tableId, child.fields).join(', ')}]`,
        `foreignColumns: [${parent.fields.map((c) => ref(parent.tableId, c)).join(', ')}]`,
      ]
      const chain = actions.map(([k, v]) => `.${k}(${jsString(v.toLowerCase())})`).join('')
      const list = extraFks.get(child.tableId) ?? []
      list.push(`${imp('foreignKey')}({ ${fk.join(', ')} })${chain}`)
      extraFks.set(child.tableId, list)
    }
  }

  /* tables */
  const tableDecl: string[] = []
  for (const t of model.tables) {
    const pk = primaryKey(t)
    const lines: string[] = []
    for (const f of t.fields) {
      const key = colKey.get(t.id)!.get(f.name)!
      lines.push(...jsDoc(f.note, '  '))
      lines.push(`  ${jsKey(key)}: ${column(t, f, pk)},`)
    }
    const extras: string[] = []
    if (pk.length > 1) {
      const name = t.indexes.find((i) => i.pk)?.name
      extras.push(`${imp('primaryKey')}({ ${name ? `name: ${jsString(name)}, ` : ''}columns: [${cols(t.id, pk).join(', ')}] })`)
    }
    for (const i of t.indexes) if (!i.pk) extras.push(indexCall(t, i))
    extras.push(...(extraFks.get(t.id) ?? []))

    const s = schemaFor(t.schema)
    const fn = s ? `${s}.table` : imp(`${core}Table`)
    const head = `export const ${tableVar.get(t.id)} = ${fn}(${jsString(t.name)}, {`
    const tail = extras.length ? `}, (t) => [\n${extras.map((e) => `  ${e},`).join('\n')}\n])` : '})'
    tableDecl.push([...jsDoc(t.note), head, ...lines, tail].join('\n'))
  }

  function column(t: TableModel, f: FieldModel, pk: string[]): string {
    const enumName = f.enumName
    const { array } = parseType(f.type)
    let call: string
    let increment = f.increment
    if (enumName && enumVar.has(enumName)) {
      call = pg ? `${enumVar.get(enumName)}(${jsString(f.name)})` : `${imp('mysqlEnum')}(${jsString(f.name)}, ${enumVar.get(enumName)})`
    } else {
      const b = pg ? pgBuilder(f.type.replace(/\[\]$/, ''), f.increment) : mysqlBuilder(f.type)
      if (b) {
        if (pg && /serial$/.test(b.fn)) increment = false
        call = `${imp(b.fn)}(${jsString(f.name)}${b.config ? `, ${b.config}` : ''})`
      } else call = `${custom(f.type.replace(/\[\]$/, ''))}(${jsString(f.name)})`
    }
    if (pg && array) call += '.array()'
    if (pk.length === 1 && pk[0] === f.name) call += '.primaryKey()'
    if (increment) call += pg ? '.generatedByDefaultAsIdentity()' : '.autoincrement()'
    if (f.notNull) call += '.notNull()'
    if (f.unique) call += '.unique()'
    const def = readDefault(f.defaultValue)
    if (def && def.kind !== 'null') {
      if (def.kind === 'expression') {
        if (isNowExpression(def.value)) call += '.defaultNow()'
        else if (pg && /^gen_random_uuid\(\)$/i.test(def.value) && parseType(f.type).base === 'uuid') call += '.defaultRandom()'
        else {
          usesSql = true
          call += `.default(sql\`${def.value.replace(/`/g, '\\`')}\`)`
        }
      } else if (def.kind === 'string') call += `.default(${jsString(def.value)})`
      // decimal columns hold strings in Drizzle
      else if (def.kind === 'number' && typeKind(parseType(f.type).base) === 'decimal') call += `.default(${jsString(def.value)})`
      else call += `.default(${String(def.value)})`
    }
    call += inline.get(`${t.id}\0${f.name}`) ?? ''
    return call
  }

  function indexCall(t: TableModel, i: IndexModel): string {
    const fn = imp(i.unique ? 'uniqueIndex' : 'index')
    // MySQL indexes must be named
    const fallback = pg ? null : `${t.name}_${i.columns.map((c) => c.replace(/\W+/g, '_').replace(/^_|_$/g, '')).join('_')}_${i.unique ? 'key' : 'idx'}`
    const name = i.name ? jsString(i.name) : fallback ? jsString(fallback) : ''
    const columns = cols(t.id, i.columns)
    if (columns.some((c) => c.startsWith('sql`'))) usesSql = true
    if (pg && i.type) return `${fn}(${name}).using(${jsString(i.type.toLowerCase())}, ${columns.join(', ')})`
    return `${fn}(${name}).on(${columns.join(', ')})`
  }

  /* print */
  const sorted = [...imports].sort()
  const coreImports = [...(selfRef ? [`type Any${pg ? 'Pg' : 'MySql'}Column`] : []), ...sorted]
  const out = ['// Generated by Schemasketch.']
  for (const n of notes) out.push(`// ${n}`)
  out.push(`import { ${coreImports.join(', ')} } from 'drizzle-orm/${core}-core'`)
  if (usesSql) out.push("import { sql } from 'drizzle-orm'")
  const sections = [customDecl, [...schemaVar].map(([s, v]) => `export const ${v} = ${pg ? 'pgSchema' : 'mysqlSchema'}(${jsString(s)})`), enumDecl]
  for (const s of sections) if (s.length) out.push('', s.join('\n'))
  for (const d of tableDecl) out.push('', d)
  return `${out.join('\n')}\n`
}

/* =====================================================================
   Import: schema.ts → SchemaModel
   ===================================================================== */

type Decl =
  | { kind: 'schema'; schema: string; dialect: ReadDialect }
  | { kind: 'tableFn'; dialect: ReadDialect }
  | { kind: 'enum'; name: string; schema: string | null; values: string[] }
  | { kind: 'values'; values: string[] }
  | { kind: 'custom'; type: string }
  | { kind: 'table'; node: JsNode; dialect: ReadDialect; schema: string | null; line: number }

const TABLE_FNS: Record<string, ReadDialect> = { pgTable: 'postgres', mysqlTable: 'mysql', sqliteTable: 'sqlite' }
const CREATOR_FNS: Record<string, ReadDialect> = { pgTableCreator: 'postgres', mysqlTableCreator: 'mysql', sqliteTableCreator: 'sqlite' }
const SCHEMA_FNS: Record<string, ReadDialect> = { pgSchema: 'postgres', mysqlSchema: 'mysql' }

const stringList = (n: JsNode | undefined, values: Map<string, string[]>): string[] | null => {
  if (n?.t === 'arr') return n.items.map(strValue).filter((s): s is string => s != null)
  if (n?.t === 'id') return values.get(n.name) ?? null
  return null
}

const DATABASE_TYPE: Record<ReadDialect, string> = { postgres: 'PostgreSQL', mysql: 'MySQL', sqlite: 'SQLite' }

const ACTION_NAMES = new Set(['cascade', 'set null', 'restrict', 'no action', 'set default'])

interface PendingRef {
  childTable: TableModel
  childCols: string[]
  /** [table variable, column key] pairs */
  target: [string, string][]
  name: string | null
  onDelete: string | null
  onUpdate: string | null
}

export function fromDrizzle(src: string): ImportResult {
  const decls = readDeclarations(src)
  const warnings: string[] = []
  const known = new Map<string, Decl>()
  const values = new Map<string, string[]>()

  for (const d of decls) {
    const init = d.init
    if (init.t === 'arr') {
      const list = stringList(init, values)
      if (list && list.length === init.items.length) {
        values.set(d.name, list)
        known.set(d.name, { kind: 'values', values: list })
      }
      continue
    }
    const { head } = flattenChain(init)
    if (!head) continue
    const owner = head.object?.t === 'id' ? known.get(head.object.name) : undefined
    if (!head.object && SCHEMA_FNS[head.name] && strValue(head.args[0])) {
      known.set(d.name, { kind: 'schema', schema: strValue(head.args[0])!, dialect: SCHEMA_FNS[head.name] })
    } else if (!head.object && CREATOR_FNS[head.name]) {
      known.set(d.name, { kind: 'tableFn', dialect: CREATOR_FNS[head.name] })
    } else if ((!head.object && head.name === 'pgEnum') || (owner?.kind === 'schema' && head.name === 'enum')) {
      const list = stringList(head.args[1], values)
      const name = strValue(head.args[0])
      if (name && list) known.set(d.name, { kind: 'enum', name, schema: owner?.kind === 'schema' ? owner.schema : null, values: list })
      else if (name) warnings.push(`Couldn't read the values of the enum ${name}.`)
    } else if (!head.object && head.name === 'customType') {
      const dataType = prop(head.args[0], 'dataType')
      const type = dataType?.t === 'arrow' ? strValue(dataType.body) : null
      if (type) known.set(d.name, { kind: 'custom', type })
    } else if (!head.object && (TABLE_FNS[head.name] || known.get(head.name)?.kind === 'tableFn')) {
      const fnDecl = known.get(head.name)
      known.set(d.name, { kind: 'table', node: init, dialect: TABLE_FNS[head.name] ?? (fnDecl?.kind === 'tableFn' ? fnDecl.dialect : 'postgres'), schema: null, line: d.line })
    } else if (owner?.kind === 'schema' && head.name === 'table') {
      known.set(d.name, { kind: 'table', node: init, dialect: owner.dialect, schema: owner.schema, line: d.line })
    }
  }

  const model = emptyModel()
  const enumByVar = new Map<string, { name: string; schema: string | null }>()
  for (const [v, d] of known) {
    if (d.kind !== 'enum') continue
    enumByVar.set(v, { name: d.name, schema: d.schema })
    model.enums.push({ id: d.schema ? `${d.schema}.${d.name}` : d.name, name: d.name, schema: d.schema, values: d.values })
  }

  const tables = new Map<string, { table: TableModel; keys: Map<string, string> }>()
  const pending: PendingRef[] = []
  const dialects = new Set<ReadDialect>()

  for (const [v, d] of known) {
    if (d.kind !== 'table') continue
    const { head } = flattenChain(d.node)
    const name = strValue(head?.args[0])
    if (!head || !name) {
      warnings.push(`Skipped the table on line ${d.line}: its name isn't a plain string.`)
      continue
    }
    dialects.add(d.dialect)
    let columnsNode = head.args[1]
    if (columnsNode?.t === 'arrow') columnsNode = columnsNode.body
    if (columnsNode?.t !== 'obj') {
      warnings.push(`Skipped table ${name}: couldn't read its columns.`)
      continue
    }
    const table = makeTable(name, d.schema)
    const keys = new Map<string, string>()
    tables.set(v, { table, keys })

    for (const p of columnsNode.props) {
      const col = readColumn(p.key, p.value, d.dialect, `${name}.${p.key}`)
      if (!col) continue
      keys.set(p.key, col.field.name)
      table.fields.push(col.field)
      if (col.ref) pending.push({ childTable: table, childCols: [col.field.name], ...col.ref })
    }
    const extras = head.args[2]
    if (extras) readExtras(extras, table, keys, name)
    if (!table.fields.length) warnings.push(`Table ${name} has no columns that could be read.`)
    model.tables.push(table)
  }

  function readColumn(key: string, node: JsNode, dialect: ReadDialect, where: string): { field: FieldModel; ref: Omit<PendingRef, 'childTable' | 'childCols'> | null } | null {
    const { head, calls } = flattenChain(node)
    if (!head) {
      warnings.push(`Skipped ${where}: it isn't a column builder.`)
      return null
    }
    const nameArg = strValue(head.args[0])
    const colName = nameArg ?? key
    const config = head.args.find((a) => a.t === 'obj')
    const field = makeField(colName, 'text')
    let ref: Omit<PendingRef, 'childTable' | 'childCols'> | null = null

    const decl = head.object ? undefined : known.get(head.name)
    if (decl?.kind === 'enum') {
      const e = enumByVar.get(head.name)!
      field.type = e.schema ? `${dbmlName(e.schema)}.${dbmlName(e.name)}` : dbmlName(e.name)
      field.enumName = e.name
    } else if (decl?.kind === 'custom') field.type = decl.type
    else if (head.name === 'mysqlEnum') {
      const list = stringList(head.args.find((a) => a.t === 'arr' || (a.t === 'id' && values.has(a.name))), values)
      const valuesArg = head.args.find((a) => a.t === 'id' && values.has(a.name))
      // a shared constant keeps its name; inline values get table_column
      const enumName = valuesArg?.t === 'id' ? valuesArg.name : where.replace('.', '_')
      if (list) {
        if (!model.enums.some((e) => e.name === enumName)) model.enums.push({ id: enumName, name: enumName, schema: null, values: list })
        field.type = dbmlName(enumName)
        field.enumName = enumName
      }
    } else {
      const t = columnType(head.name, config, dialect)
      if (!t) warnings.push(`${where} uses ${head.name}(), which isn't a known column type; it was imported as ${head.name.toLowerCase()}.`)
      field.type = t?.type ?? head.name.toLowerCase()
      field.increment = !!t?.increment
    }

    for (const c of calls) {
      switch (c.name) {
        case 'notNull':
          field.notNull = true
          break
        case 'primaryKey':
          field.pk = true
          if (prop(c.args[0], 'autoIncrement')?.t === 'bool') field.increment = true
          break
        case 'unique':
          field.unique = true
          break
        case 'autoincrement':
        case 'generatedAlwaysAsIdentity':
        case 'generatedByDefaultAsIdentity':
          field.increment = true
          break
        case 'array':
          field.type = `${field.type}[]`
          break
        case 'defaultNow':
          field.defaultValue = '`now()`'
          break
        case 'defaultRandom':
          field.defaultValue = '`gen_random_uuid()`'
          break
        case 'default': {
          const v = jsDefault(c.args[0])
          // decimals take string defaults in Drizzle; DBML writes them as numbers
          if (v && typeKind(parseType(field.type).base) === 'decimal' && /^'-?\d+(\.\d+)?'$/.test(v)) field.defaultValue = v.slice(1, -1)
          else if (v) field.defaultValue = v
          else warnings.push(`${where}: left out a default that isn't a plain value.`)
          break
        }
        case 'references': {
          const fn = c.args[0]
          const target = fn?.t === 'arrow' ? fn.body : null
          if (target?.t === 'member' && target.object.t === 'id') {
            ref = { target: [[target.object.name, target.prop]], name: null, onDelete: action(prop(c.args[1], 'onDelete')), onUpdate: action(prop(c.args[1], 'onUpdate')) }
          } else warnings.push(`${where}: couldn't follow its references().`)
          break
        }
      }
    }
    if (field.pk) field.notNull = false // implied by the key, as DBML writes it
    return { field, ref }
  }

  function readExtras(node: JsNode, table: TableModel, keys: Map<string, string>, where: string) {
    const body = node.t === 'arrow' ? node.body : node
    const items = body.t === 'arr' ? body.items : body.t === 'obj' ? body.props.map((p) => p.value) : []
    const colOf = (n: JsNode): string | null => {
      if (n.t === 'member') return keys.get(n.prop) ?? n.prop
      // sql`lower(${t.email})` → `lower(email)`
      if (n.t === 'tpl' && n.tag?.t === 'id' && n.tag.name === 'sql') return `\`${n.raw.replace(/\$\{\s*\w+\.(\w+)\s*\}/g, (_, k: string) => keys.get(k) ?? k)}\``
      return null
    }
    const colList = (ns: JsNode[]) => ns.map(colOf).filter((c): c is string => !!c)
    const arrayItems = (n: JsNode | undefined) => (n?.t === 'arr' ? n.items : [])
    for (const item of items) {
      const { head, calls } = flattenChain(item)
      if (!head || head.object) continue
      switch (head.name) {
        case 'primaryKey': {
          // primaryKey({ columns: [t.a, t.b] }), or the older primaryKey(t.a, t.b)
          const opts = head.args[0]
          const columns = opts?.t === 'obj' ? colList(arrayItems(prop(opts, 'columns'))) : colList(head.args)
          if (columns.length === 1 && !prop(opts, 'name')) {
            const f = table.fields.find((x) => x.name === columns[0])
            if (f) f.pk = true
          } else if (columns.length) table.indexes.push(makeIndex(columns, { pk: true, name: strValue(prop(opts, 'name')) }))
          break
        }
        case 'index':
        case 'uniqueIndex':
        case 'unique': {
          let type: string | null = null
          let columns: string[] = []
          for (const c of calls) {
            if (c.name === 'on') columns = colList(c.args)
            if (c.name === 'using') {
              type = strValue(c.args[0])
              columns = colList(c.args.slice(1))
            }
          }
          if (columns.length) table.indexes.push(makeIndex(columns, { name: strValue(head.args[0]), unique: head.name !== 'index', type }))
          break
        }
        case 'foreignKey': {
          const opts = head.args[0]
          const childCols = colList(arrayItems(prop(opts, 'columns')))
          const target = arrayItems(prop(opts, 'foreignColumns')).flatMap((n): [string, string][] => (n.t === 'member' && n.object.t === 'id' ? [[n.object.name, n.prop]] : []))
          let onDelete: string | null = null
          let onUpdate: string | null = null
          for (const c of calls) {
            if (c.name === 'onDelete') onDelete = action(c.args[0])
            if (c.name === 'onUpdate') onUpdate = action(c.args[0])
          }
          if (childCols.length && childCols.length === target.length) pending.push({ childTable: table, childCols, target, name: strValue(prop(opts, 'name')), onDelete, onUpdate })
          else warnings.push(`${where}: couldn't read a foreignKey().`)
          break
        }
      }
    }
  }

  /* relationships, now that every table is known */
  for (const p of pending) {
    const parent = tables.get(p.target[0][0])
    if (!parent || p.target.some(([v]) => v !== p.target[0][0])) {
      warnings.push(`${p.childTable.name}.${p.childCols.join(', ')} references a table that isn't in this file.`)
      continue
    }
    const parentCols = p.target.map(([, k]) => parent.keys.get(k) ?? k)
    const fks = p.childCols.map((c) => p.childTable.fields.find((f) => f.name === c))
    // a unique foreign key makes it one-to-one
    const oneToOne = (fks.length === 1 && (fks[0]?.unique || fks[0]?.pk)) || p.childTable.indexes.some((i) => i.unique && i.columns.join() === p.childCols.join())
    const r: RefModel = {
      id: `ref:${model.refs.length + 1}`,
      name: p.name,
      source: { tableId: p.childTable.id, fields: p.childCols, cardinality: oneToOne ? 'one' : 'many' },
      target: { tableId: parent.table.id, fields: parentCols, cardinality: 'one' },
      onDelete: p.onDelete,
      onUpdate: p.onUpdate,
    }
    model.refs.push(r)
  }

  if (!model.tables.length && !model.enums.length) {
    throw new Error('No Drizzle tables found. Paste a schema file with pgTable(…), mysqlTable(…) or sqliteTable(…) definitions.')
  }
  if (dialects.size === 1) model.databaseType = DATABASE_TYPE[[...dialects][0]]
  return { model: finishModel(model), warnings }
}

function action(n: JsNode | undefined): string | null {
  const s = strValue(n)?.toLowerCase() ?? null
  return s && ACTION_NAMES.has(s) ? s : null
}

function jsDefault(n: JsNode | undefined): string | null {
  if (!n) return null
  if (n.t === 'str') return writeDefault({ kind: 'string', value: n.value })
  if (n.t === 'num') return String(n.value)
  if (n.t === 'bool') return String(n.value)
  if (n.t === 'null') return 'null'
  if (n.t === 'tpl') {
    if (n.tag?.t === 'id' && n.tag.name === 'sql') return writeDefault({ kind: 'expression', value: n.raw })
    if (!n.tag && !n.raw.includes('${')) return writeDefault({ kind: 'string', value: n.raw })
  }
  return null
}

/** Builder name + config → DBML type. */
function columnType(fn: string, config: JsNode | undefined, dialect: ReadDialect): { type: string; increment?: boolean } | null {
  const n = (k: string) => {
    const v = prop(config, k)
    return v?.t === 'num' ? String(v.value) : null
  }
  const withArgs = (base: string, ...args: (string | null)[]) => {
    const a = args.filter((x): x is string => x != null)
    return a.length ? `${base}(${a.join(',')})` : base
  }
  const tz = prop(config, 'withTimezone')?.t === 'bool' && (prop(config, 'withTimezone') as { value: boolean }).value
  if (dialect === 'sqlite') {
    const map: Record<string, string> = { integer: 'integer', int: 'integer', text: 'text', real: 'real', blob: 'blob', numeric: 'numeric' }
    return map[fn] ? { type: map[fn] } : null
  }
  if (dialect === 'mysql') {
    switch (fn) {
      case 'serial':
        return { type: 'serial' }
      case 'int':
      case 'tinyint':
      case 'smallint':
      case 'mediumint':
      case 'bigint':
      case 'boolean':
      case 'text':
      case 'tinytext':
      case 'mediumtext':
      case 'longtext':
      case 'json':
      case 'date':
      case 'year':
      case 'real':
      case 'float':
      case 'double':
        return { type: fn }
      case 'varchar':
      case 'char':
      case 'binary':
      case 'varbinary':
        return { type: withArgs(fn, n('length')) }
      case 'decimal':
        return { type: withArgs('decimal', n('precision'), n('scale')) }
      case 'datetime':
      case 'timestamp':
      case 'time':
        return { type: withArgs(fn, n('fsp')) }
      default:
        return null
    }
  }
  switch (fn) {
    case 'serial':
      return { type: 'integer', increment: true }
    case 'smallserial':
      return { type: 'smallint', increment: true }
    case 'bigserial':
      return { type: 'bigint', increment: true }
    case 'integer':
    case 'smallint':
    case 'bigint':
    case 'boolean':
    case 'text':
    case 'uuid':
    case 'date':
    case 'json':
    case 'jsonb':
    case 'real':
    case 'interval':
    case 'inet':
    case 'cidr':
    case 'macaddr':
    case 'macaddr8':
    case 'point':
    case 'line':
      return { type: fn }
    case 'doublePrecision':
      return { type: 'double precision' }
    case 'varchar':
    case 'char':
      return { type: withArgs(fn, n('length')) }
    case 'numeric':
    case 'decimal':
      return { type: withArgs(fn, n('precision'), n('scale')) }
    case 'timestamp':
      return { type: withArgs(tz ? 'timestamptz' : 'timestamp', n('precision')) }
    case 'time':
      return { type: withArgs(tz ? 'timetz' : 'time', n('precision')) }
    case 'vector':
    case 'halfvec':
    case 'bit':
    case 'sparsevec':
      return { type: withArgs(fn, n('dimensions')) }
    case 'geometry':
      return { type: 'geometry' }
    default:
      return null
  }
}
