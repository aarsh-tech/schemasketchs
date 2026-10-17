import type { FieldModel, IndexModel, RefEndpoint, SchemaModel, TableModel } from '@/lib/dbml/types'
import { toDbmlType } from '@/lib/dbml/values'
import { dbmlString, relationsOf } from './shared'

/* SchemaModel → DBML text. Used by the importers, which build a model first. */

const BARE = /^[A-Za-z_][A-Za-z0-9_]*$/

export const dbmlName = (n: string) => (BARE.test(n) ? n : `"${n.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)

const qualified = (schema: string | null, name: string) => (schema ? `${dbmlName(schema)}.${dbmlName(name)}` : dbmlName(name))

// a ''' block keeps everything between the first line break and the closing quotes
const note = (s: string) => (s.includes('\n') ? `'''\n${s.replace(/'''/g, "\\'''")}'''` : dbmlString(s))

function fieldLine(f: FieldModel): string {
  const settings: string[] = []
  if (f.pk) settings.push('pk')
  if (f.increment) settings.push('increment')
  if (f.notNull) settings.push('not null')
  if (f.unique) settings.push('unique')
  if (f.defaultValue != null) settings.push(`default: ${f.defaultValue}`)
  if (f.note) settings.push(`note: ${note(f.note)}`)
  // enum types are already written as DBML names by the importers
  const type = f.enumName ? f.type : toDbmlType(f.type)
  return `  ${dbmlName(f.name)} ${type}${settings.length ? ` [${settings.join(', ')}]` : ''}`
}

const indexColumn = (c: string) => (c.startsWith('`') ? c : dbmlName(c))

function indexLine(i: IndexModel): string {
  const cols = i.columns.length === 1 ? indexColumn(i.columns[0]) : `(${i.columns.map(indexColumn).join(', ')})`
  const settings: string[] = []
  if (i.pk) settings.push('pk')
  if (i.unique) settings.push('unique')
  if (i.name) settings.push(`name: ${dbmlString(i.name)}`)
  if (i.type) settings.push(`type: ${i.type}`)
  return `    ${cols}${settings.length ? ` [${settings.join(', ')}]` : ''}`
}

function tableBlock(t: TableModel): string[] {
  const settings: string[] = []
  if (t.headerColor) settings.push(`headercolor: ${t.headerColor}`)
  const head = `Table ${qualified(t.schema, t.name)}${t.alias ? ` as ${dbmlName(t.alias)}` : ''}${settings.length ? ` [${settings.join(', ')}]` : ''} {`
  const lines = [head, ...t.fields.map(fieldLine)]
  if (t.indexes.length) lines.push('', '  indexes {', ...t.indexes.map(indexLine), '  }')
  if (t.note) lines.push('', `  Note: ${note(t.note)}`)
  lines.push('}')
  return lines
}

export function toDbml(model: SchemaModel, opts: { header?: string } = {}): string {
  const blocks: string[][] = []
  if (opts.header) blocks.push(opts.header.split('\n').map((l) => `// ${l}`.trimEnd()))
  if (model.databaseType || model.projectName) {
    blocks.push([`Project ${model.projectName ? `${dbmlName(model.projectName)} ` : ''}{`, ...(model.databaseType ? [`  database_type: ${dbmlString(model.databaseType)}`] : []), '}'])
  }
  for (const e of model.enums) {
    blocks.push([`Enum ${qualified(e.schema, e.name)} {`, ...e.values.map((v) => `  ${dbmlName(v)}`), '}'])
  }
  const byId = new Map(model.tables.map((t) => [t.id, t]))
  for (const t of model.tables) blocks.push(tableBlock(t))

  const end = (e: RefEndpoint) => {
    const t = byId.get(e.tableId)
    const table = t ? qualified(t.schema, t.name) : e.tableId.split('.').map(dbmlName).join('.')
    return `${table}.${e.fields.length === 1 ? dbmlName(e.fields[0]) : `(${e.fields.map(dbmlName).join(', ')})`}`
  }
  const refs = relationsOf(model).map(({ ref, kind, child, parent }) => {
    const op = kind === 'many-to-many' ? '<>' : kind === 'one-to-one' ? '-' : '>'
    const settings: string[] = []
    if (ref.onDelete) settings.push(`delete: ${ref.onDelete}`)
    if (ref.onUpdate) settings.push(`update: ${ref.onUpdate}`)
    return `Ref${ref.name ? ` ${dbmlName(ref.name)}` : ''}: ${end(child)} ${op} ${end(parent)}${settings.length ? ` [${settings.join(', ')}]` : ''}`
  })
  if (refs.length) blocks.push(refs)

  for (const g of model.groups) {
    const lines = [`TableGroup ${dbmlName(g.name)}${g.color ? ` [color: ${g.color}]` : ''} {`]
    for (const id of g.tableIds) {
      const t = byId.get(id)
      if (t) lines.push(`  ${qualified(t.schema, t.name)}`)
    }
    if (g.note) lines.push('', `  Note: ${note(g.note)}`)
    lines.push('}')
    blocks.push(lines)
  }
  for (const n of model.notes) blocks.push([`Note ${dbmlName(n.name)} {`, `  ${note(n.content)}`, '}'])

  return `${blocks.map((b) => b.join('\n')).join('\n\n')}\n`
}
