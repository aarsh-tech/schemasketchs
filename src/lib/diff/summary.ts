import type { FieldModel, IndexModel, RefModel } from '@/lib/dbml/types'
import type { ColumnChange, SchemaDiff } from './schema'

export type ChangeKind = 'add' | 'remove' | 'change' | 'rename'
/** destructive: loses data. caution: can fail or lose data depending on what's in the table. */
export type Risk = 'destructive' | 'caution' | null

export interface SummaryItem {
  kind: ChangeKind
  /** what the change is about, e.g. a table or "table.column" */
  subject: string
  text: string
  risk: Risk
  /** why it's risky */
  note?: string
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function describeColumn(f: FieldModel): string {
  const bits = [f.type]
  if (f.pk) bits.push('pk')
  if (f.notNull) bits.push('not null')
  if (f.unique) bits.push('unique')
  if (f.increment) bits.push('increment')
  if (f.defaultValue !== null) bits.push(`default ${f.defaultValue}`)
  return `${f.name} ${bits.join(', ')}`
}

export const describeIndex = (i: IndexModel) =>
  `${i.unique ? 'unique index' : 'index'} ${i.name ? `${i.name} ` : ''}(${i.columns.join(', ')})${i.type ? ` using ${i.type}` : ''}`

export const describeRef = (r: RefModel) => `${r.source.tableId}.${r.source.fields.join(', ')} → ${r.target.tableId}.${r.target.fields.join(', ')}`

function describeChange(c: ColumnChange): string {
  const { from, to } = c
  return c.attrs
    .map((a) => {
      if (a === 'type') return `type ${from.type} → ${to.type}`
      if (a === 'notNull') return to.notNull ? 'now not null' : 'now nullable'
      if (a === 'unique') return to.unique ? 'now unique' : 'no longer unique'
      if (a === 'increment') return to.increment ? 'now auto-increments' : 'no longer auto-increments'
      if (from.defaultValue === null) return `default set to ${to.defaultValue}`
      if (to.defaultValue === null) return `default ${from.defaultValue} removed`
      return `default ${from.defaultValue} → ${to.defaultValue}`
    })
    .join('; ')
}

/** A readable list of what the migration does, in the order a reader would want it. */
export function summarize(d: SchemaDiff): SummaryItem[] {
  const out: SummaryItem[] = []

  for (const e of d.addedEnums) out.push({ kind: 'add', subject: e.id, text: `new enum (${e.values.join(', ')})`, risk: null })

  for (const t of d.addedTables) out.push({ kind: 'add', subject: t.id, text: `new table with ${plural(t.fields.length, 'column')}`, risk: null })

  for (const c of d.changedTables) if (c.renamed) out.push({ kind: 'rename', subject: c.from.id, text: `renamed to ${c.to.id}`, risk: null })

  for (const c of d.changedTables) {
    const name = c.to.id
    for (const f of c.addedColumns) {
      const failsOnRows = f.notNull && f.defaultValue === null && !f.increment
      out.push({
        kind: 'add',
        subject: `${name}.${f.name}`,
        text: `new column: ${describeColumn(f).slice(f.name.length + 1)}`,
        risk: failsOnRows ? 'caution' : null,
        note: failsOnRows ? 'Not null with no default: fails if the table already has rows.' : undefined,
      })
    }
    for (const f of c.removedColumns)
      out.push({ kind: 'remove', subject: `${name}.${f.name}`, text: 'column dropped', risk: 'destructive', note: 'Its data is deleted.' })
    for (const cc of c.changedColumns) {
      const typeChange = cc.attrs.includes('type')
      const nowRequired = cc.attrs.includes('notNull') && cc.to.notNull
      out.push({
        kind: 'change',
        subject: `${name}.${cc.to.name}`,
        text: describeChange(cc),
        risk: typeChange || nowRequired ? 'caution' : null,
        note: typeChange
          ? 'Existing values must convert to the new type, and may be cut short.'
          : nowRequired
            ? 'Fails if any row has a null here.'
            : undefined,
      })
    }
    if (c.primaryKey) {
      const { from, to } = c.primaryKey
      const text = !to.length ? `primary key (${from.join(', ')}) removed` : !from.length ? `primary key set to (${to.join(', ')})` : `primary key (${from.join(', ')}) → (${to.join(', ')})`
      out.push({ kind: 'change', subject: name, text, risk: null })
    }
    for (const i of c.removedIndexes) out.push({ kind: 'remove', subject: name, text: `${describeIndex(i)} removed`, risk: null })
    for (const i of c.addedIndexes) out.push({ kind: 'add', subject: name, text: `new ${describeIndex(i)}`, risk: null })
  }

  for (const t of d.removedTables)
    out.push({ kind: 'remove', subject: t.id, text: `table dropped (${plural(t.fields.length, 'column')})`, risk: 'destructive', note: 'All of its rows are deleted.' })

  for (const e of d.changedEnums) {
    if (e.addedValues.length) out.push({ kind: 'change', subject: e.to.id, text: `enum values added: ${e.addedValues.join(', ')}`, risk: null })
    if (e.removedValues.length)
      out.push({
        kind: 'change',
        subject: e.to.id,
        text: `enum values removed: ${e.removedValues.join(', ')}`,
        risk: 'destructive',
        note: 'Rows that use these values must be changed first.',
      })
  }
  for (const e of d.removedEnums) out.push({ kind: 'remove', subject: e.id, text: 'enum dropped', risk: null })

  for (const r of d.removedRefs) out.push({ kind: 'remove', subject: describeRef(r), text: 'relationship removed', risk: null })
  for (const r of d.addedRefs) out.push({ kind: 'add', subject: describeRef(r), text: 'new relationship', risk: null })

  return out
}
