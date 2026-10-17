import type { EnumModel, FieldModel, IndexModel, RefModel, SchemaModel, TableModel } from '@/lib/dbml/types'

/* Compare two parsed schemas. Everything here is pure and works on plain SchemaModels. */

export type ColumnAttr = 'type' | 'notNull' | 'default' | 'unique' | 'increment'

export interface ColumnChange {
  from: FieldModel
  to: FieldModel
  attrs: ColumnAttr[]
}

export interface TableChange {
  from: TableModel
  to: TableModel
  renamed: boolean
  addedColumns: FieldModel[]
  removedColumns: FieldModel[]
  changedColumns: ColumnChange[]
  addedIndexes: IndexModel[]
  removedIndexes: IndexModel[]
  /** set when the primary key columns change; an empty list means no primary key */
  primaryKey: { from: string[]; to: string[] } | null
}

export interface EnumChange {
  from: EnumModel
  to: EnumModel
  addedValues: string[]
  removedValues: string[]
}

export interface SchemaDiff {
  addedTables: TableModel[]
  removedTables: TableModel[]
  /** tables present on both sides (possibly renamed) that differ */
  changedTables: TableChange[]
  addedEnums: EnumModel[]
  removedEnums: EnumModel[]
  changedEnums: EnumChange[]
  addedRefs: RefModel[]
  removedRefs: RefModel[]
}

export interface DiffOptions {
  /** pair a removed table with a similar added one and treat it as a rename (default true) */
  detectRenames?: boolean
}

/** Share of columns (by name and type) two tables must have in common to count as a rename. */
export const RENAME_THRESHOLD = 0.5

export const normType = (t: string) => t.toLowerCase().replace(/\s+/g, '')

/** Columns of the primary key: a composite `[pk]` index wins over column flags. */
export function primaryKeyOf(t: TableModel): string[] {
  const index = t.indexes.find((i) => i.pk)
  return index ? index.columns : t.fields.filter((f) => f.pk).map((f) => f.name)
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

function columnAttrs(a: FieldModel, b: FieldModel): ColumnAttr[] {
  const attrs: ColumnAttr[] = []
  if (normType(a.type) !== normType(b.type)) attrs.push('type')
  if (a.notNull !== b.notNull) attrs.push('notNull')
  if (a.defaultValue !== b.defaultValue) attrs.push('default')
  if (a.unique !== b.unique) attrs.push('unique')
  if (a.increment !== b.increment) attrs.push('increment')
  return attrs
}

const indexKey = (i: IndexModel) => `${i.name ?? ''}|${i.unique}|${i.type ?? ''}|${i.columns.join(',')}`

function diffTable(from: TableModel, to: TableModel): TableChange | null {
  const fromFields = new Map(from.fields.map((f) => [f.name, f]))
  const toNames = new Set(to.fields.map((f) => f.name))
  const changedColumns: ColumnChange[] = []
  for (const f of to.fields) {
    const old = fromFields.get(f.name)
    const attrs = old ? columnAttrs(old, f) : []
    if (old && attrs.length) changedColumns.push({ from: old, to: f, attrs })
  }
  const fromIdx = from.indexes.filter((i) => !i.pk)
  const toIdx = to.indexes.filter((i) => !i.pk)
  const fromKeys = new Set(fromIdx.map(indexKey))
  const toKeys = new Set(toIdx.map(indexKey))
  const pkFrom = primaryKeyOf(from)
  const pkTo = primaryKeyOf(to)

  const change: TableChange = {
    from,
    to,
    renamed: from.id !== to.id,
    addedColumns: to.fields.filter((f) => !fromFields.has(f.name)),
    removedColumns: from.fields.filter((f) => !toNames.has(f.name)),
    changedColumns,
    addedIndexes: toIdx.filter((i) => !fromKeys.has(indexKey(i))),
    removedIndexes: fromIdx.filter((i) => !toKeys.has(indexKey(i))),
    primaryKey: sameList(pkFrom, pkTo) ? null : { from: pkFrom, to: pkTo },
  }
  const empty =
    !change.renamed &&
    !change.addedColumns.length &&
    !change.removedColumns.length &&
    !changedColumns.length &&
    !change.addedIndexes.length &&
    !change.removedIndexes.length &&
    !change.primaryKey
  return empty ? null : change
}

/** How alike two tables' columns are, 0 to 1 (Jaccard index on name + type). */
export function tableSimilarity(a: TableModel, b: TableModel): number {
  const sig = (f: FieldModel) => `${f.name}:${normType(f.type)}`
  const sa = new Set(a.fields.map(sig))
  const sb = new Set(b.fields.map(sig))
  if (!sa.size && !sb.size) return 0
  let shared = 0
  for (const s of sa) if (sb.has(s)) shared++
  return shared / (sa.size + sb.size - shared)
}

/** Pair removed tables with added ones that look like the same table under a new name. */
function findRenames(removed: TableModel[], added: TableModel[]): [TableModel, TableModel][] {
  const candidates: { from: TableModel; to: TableModel; score: number }[] = []
  for (const from of removed)
    for (const to of added) {
      if (from.schema !== to.schema) continue
      const score = tableSimilarity(from, to)
      if (score >= RENAME_THRESHOLD) candidates.push({ from, to, score })
    }
  candidates.sort((a, b) => b.score - a.score || a.from.id.localeCompare(b.from.id) || a.to.id.localeCompare(b.to.id))
  const used = new Set<string>()
  const pairs: [TableModel, TableModel][] = []
  for (const c of candidates) {
    if (used.has(`from:${c.from.id}`) || used.has(`to:${c.to.id}`)) continue
    used.add(`from:${c.from.id}`)
    used.add(`to:${c.to.id}`)
    pairs.push([c.from, c.to])
  }
  return pairs
}

export const isManyToMany = (r: RefModel) => r.source.cardinality.endsWith('many') && r.target.cardinality.endsWith('many')

/** Identity of a relationship, with table ids mapped through `rename` (old id → new id). */
function refKey(r: RefModel, rename: Map<string, string> = new Map()): string {
  const end = (e: RefModel['source']) => `${rename.get(e.tableId) ?? e.tableId}(${e.fields.join(',')})`
  return [r.name ?? '', end(r.source), end(r.target), isManyToMany(r) ? 'n:m' : '', r.onDelete ?? '', r.onUpdate ?? ''].join('|')
}

export function diffSchemas(from: SchemaModel, to: SchemaModel, opts: DiffOptions = {}): SchemaDiff {
  const detectRenames = opts.detectRenames ?? true
  const toTables = new Map(to.tables.map((t) => [t.id, t]))
  const fromTables = new Map(from.tables.map((t) => [t.id, t]))
  let removedTables = from.tables.filter((t) => !toTables.has(t.id))
  let addedTables = to.tables.filter((t) => !fromTables.has(t.id))

  const pairs: [TableModel, TableModel][] = from.tables.filter((t) => toTables.has(t.id)).map((t) => [t, toTables.get(t.id)!])
  const rename = new Map<string, string>()
  if (detectRenames) {
    const renames = findRenames(removedTables, addedTables)
    for (const [a, b] of renames) rename.set(a.id, b.id)
    removedTables = removedTables.filter((t) => !rename.has(t.id))
    const renamedTo = new Set(rename.values())
    addedTables = addedTables.filter((t) => !renamedTo.has(t.id))
    pairs.push(...renames)
  }
  const changedTables = pairs.map(([a, b]) => diffTable(a, b)).filter((c): c is TableChange => !!c)

  const toEnums = new Map(to.enums.map((e) => [e.id, e]))
  const fromEnums = new Map(from.enums.map((e) => [e.id, e]))
  const changedEnums: EnumChange[] = []
  for (const e of from.enums) {
    const next = toEnums.get(e.id)
    if (!next) continue
    const addedValues = next.values.filter((v) => !e.values.includes(v))
    const removedValues = e.values.filter((v) => !next.values.includes(v))
    if (addedValues.length || removedValues.length) changedEnums.push({ from: e, to: next, addedValues, removedValues })
  }

  const toRefKeys = new Set(to.refs.map((r) => refKey(r)))
  const fromRefKeys = new Set(from.refs.map((r) => refKey(r, rename)))

  return {
    addedTables,
    removedTables,
    changedTables,
    addedEnums: to.enums.filter((e) => !fromEnums.has(e.id)),
    removedEnums: from.enums.filter((e) => !toEnums.has(e.id)),
    changedEnums,
    addedRefs: to.refs.filter((r) => !fromRefKeys.has(refKey(r))),
    removedRefs: from.refs.filter((r) => !toRefKeys.has(refKey(r, rename))),
  }
}

/** The same diff seen from the other side, used for the "down" script. */
export function invertDiff(d: SchemaDiff): SchemaDiff {
  return {
    addedTables: d.removedTables,
    removedTables: d.addedTables,
    changedTables: d.changedTables.map((c) => ({
      from: c.to,
      to: c.from,
      renamed: c.renamed,
      addedColumns: c.removedColumns,
      removedColumns: c.addedColumns,
      changedColumns: c.changedColumns.map((cc) => ({ from: cc.to, to: cc.from, attrs: cc.attrs })),
      addedIndexes: c.removedIndexes,
      removedIndexes: c.addedIndexes,
      primaryKey: c.primaryKey ? { from: c.primaryKey.to, to: c.primaryKey.from } : null,
    })),
    addedEnums: d.removedEnums,
    removedEnums: d.addedEnums,
    changedEnums: d.changedEnums.map((e) => ({ from: e.to, to: e.from, addedValues: e.removedValues, removedValues: e.addedValues })),
    addedRefs: d.removedRefs,
    removedRefs: d.addedRefs,
  }
}

export function isEmptyDiff(d: SchemaDiff): boolean {
  return (
    !d.addedTables.length &&
    !d.removedTables.length &&
    !d.changedTables.length &&
    !d.addedEnums.length &&
    !d.removedEnums.length &&
    !d.changedEnums.length &&
    !d.addedRefs.length &&
    !d.removedRefs.length
  )
}
