import type {
  Cardinality,
  EnumModel,
  FieldModel,
  GroupModel,
  IndexModel,
  ParseDiagnostic,
  RefModel,
  SchemaModel,
  StickyNoteModel,
  TableModel,
} from './types'
import { NOTE_PREFIX } from './types'

/* The normalized model from @dbml/core is a set of id → record maps. We only
   type the parts we read, and read them defensively. */
type Dict<T> = Record<string | number, T>
interface NField {
  name: string
  type?: { type_name?: string; args?: string | null; schemaName?: string | null }
  pk?: boolean
  unique?: boolean
  not_null?: boolean
  increment?: boolean
  note?: string | null
  dbdefault?: { value: unknown; type: string } | null
  endpointIds?: number[]
  enumId?: number | null
}
interface NTable {
  id: number
  name: string
  alias?: string | null
  note?: string | null
  headerColor?: string | null
  fieldIds: number[]
  indexIds?: number[]
  schemaId: number
  groupId?: number | null
}
interface NEndpoint {
  schemaName: string | null
  tableName: string
  fieldNames: string[]
  relation: string
}
interface NRef {
  id: number
  name?: string | null
  endpointIds: number[]
  onDelete?: string | null
  onUpdate?: string | null
}
interface NormalizedLike {
  database?: Dict<{ databaseType?: string | null; name?: string | null }>
  schemas?: Dict<{ name: string }>
  tables?: Dict<NTable>
  fields?: Dict<NField>
  endpoints?: Dict<NEndpoint>
  refs?: Dict<NRef>
  tableGroups?: Dict<{ id: number; name: string; color?: string | null; note?: string | null; tableIds: number[] }>
  enums?: Dict<{ id: number; name: string; valueIds: number[]; schemaId: number }>
  enumValues?: Dict<{ name: string }>
  notes?: Dict<{ id: number; name: string; content: string; color?: string | null; metadata?: { headercolor?: string } }>
  indexes?: Dict<{ name?: string | null; type?: string | null; unique?: boolean; pk?: boolean; columnIds?: number[] }>
  indexColumns?: Dict<{ type: string; value: string }>
}

const DEFAULT_SCHEMA = 'public'

export function tableKey(schema: string | null | undefined, name: string): string {
  return schema && schema !== DEFAULT_SCHEMA ? `${schema}.${name}` : name
}

function toCardinality(relation: string): Cardinality {
  const many = relation.includes('*')
  const optional = relation.startsWith('0')
  if (many) return optional ? 'zero-many' : 'many'
  return optional ? 'zero-one' : 'one'
}

function formatDefault(d: NField['dbdefault']): string | null {
  if (!d) return null
  const v = String(d.value)
  if (d.type === 'string') return `'${v}'`
  if (d.type === 'expression') return `\`${v}\``
  return v
}

function formatType(t: NField['type']): string {
  if (!t?.type_name) return ''
  const base = t.schemaName ? `${t.schemaName}.${t.type_name}` : t.type_name
  // dbml keeps args inside type_name for most types already, e.g. "varchar(255)"
  return t.args && !base.includes('(') ? `${base}(${t.args})` : base
}

export function toSchemaModel(n: NormalizedLike): SchemaModel {
  const toIndex = (i: NonNullable<NormalizedLike['indexes']>[number]): IndexModel => ({
    name: i.name ?? null,
    columns: (i.columnIds ?? [])
      .map((cid) => n.indexColumns?.[cid])
      .filter((c) => !!c)
      .map((c) => (c.type === 'expression' ? `\`${c.value}\`` : c.value)),
    unique: !!i.unique,
    pk: !!i.pk,
    type: i.type ?? null,
  })
  const schemas = n.schemas ?? {}
  const fields = n.fields ?? {}
  const db = Object.values(n.database ?? {})[0]

  const schemaName = (id: number) => schemas[id]?.name ?? null
  const tableIdByNumeric = new Map<number, string>()

  const enumsByNumeric = new Map<number, string>()
  const enums: EnumModel[] = Object.values(n.enums ?? {}).map((e) => {
    const schema = schemaName(e.schemaId)
    enumsByNumeric.set(e.id, e.name)
    return {
      id: tableKey(schema, e.name),
      name: e.name,
      schema: schema === DEFAULT_SCHEMA ? null : schema,
      values: e.valueIds.map((vid) => n.enumValues?.[vid]?.name ?? '').filter(Boolean),
    }
  })

  const groupKey = (id: number) => `group:${id}`

  const tables: TableModel[] = Object.values(n.tables ?? {}).map((t) => {
    const schema = schemaName(t.schemaId)
    const id = tableKey(schema, t.name)
    tableIdByNumeric.set(t.id, id)
    const tableFields: FieldModel[] = t.fieldIds
      .map((fid) => fields[fid])
      .filter(Boolean)
      .map((f) => ({
        name: f.name,
        type: formatType(f.type),
        pk: !!f.pk,
        unique: !!f.unique,
        notNull: !!f.not_null,
        increment: !!f.increment,
        defaultValue: formatDefault(f.dbdefault),
        note: f.note ?? null,
        enumName: f.enumId != null ? (enumsByNumeric.get(f.enumId) ?? null) : null,
        isRef: (f.endpointIds?.length ?? 0) > 0,
      }))
    return {
      id,
      name: t.name,
      schema: schema === DEFAULT_SCHEMA ? null : schema,
      alias: t.alias ?? null,
      note: t.note ?? null,
      headerColor: t.headerColor ?? null,
      groupId: t.groupId != null ? groupKey(t.groupId) : null,
      fields: tableFields,
      indexCount: t.indexIds?.length ?? 0,
      indexes: (t.indexIds ?? [])
        .map((iid) => n.indexes?.[iid])
        .filter((i) => !!i)
        .map(toIndex),
    }
  })

  const endpoint = (eid: number) => n.endpoints?.[eid]
  const refs: RefModel[] = []
  for (const r of Object.values(n.refs ?? {})) {
    const [a, b] = r.endpointIds.map(endpoint)
    if (!a || !b) continue
    // In DBML the endpoint marked "1" is usually the referenced (parent) side.
    // We draw from the child (many side) to the parent.
    const aIsParent = !a.relation.includes('*') && b.relation.includes('*')
    const [child, parent] = aIsParent ? [b, a] : [a, b]
    refs.push({
      id: `ref:${r.id}`,
      name: r.name ?? null,
      source: {
        tableId: tableKey(child.schemaName, child.tableName),
        fields: child.fieldNames,
        cardinality: toCardinality(child.relation),
      },
      target: {
        tableId: tableKey(parent.schemaName, parent.tableName),
        fields: parent.fieldNames,
        cardinality: toCardinality(parent.relation),
      },
      onDelete: r.onDelete ?? null,
      onUpdate: r.onUpdate ?? null,
    })
  }

  const groups: GroupModel[] = Object.values(n.tableGroups ?? {}).map((g) => ({
    id: groupKey(g.id),
    name: g.name,
    color: g.color ?? null,
    note: g.note ?? null,
    tableIds: g.tableIds.map((tid) => tableIdByNumeric.get(tid)).filter((x): x is string => !!x),
  }))

  const notes: StickyNoteModel[] = Object.values(n.notes ?? {}).map((s) => ({
    id: `${NOTE_PREFIX}${s.name}`,
    name: s.name,
    content: s.content,
    color: s.color ?? s.metadata?.headercolor ?? null,
  }))

  return {
    databaseType: db?.databaseType ?? null,
    projectName: db?.name ?? null,
    tables,
    refs,
    groups,
    enums,
    notes,
  }
}

interface RawDiag {
  message?: string
  text?: string
  location?: { start?: { line?: number; column?: number }; end?: { line?: number; column?: number } }
}

/** Turn whatever the parser threw into a list of diagnostics. */
export function toDiagnostics(err: unknown): ParseDiagnostic[] {
  const diags = (err as { diags?: RawDiag[] } | null)?.diags
  if (Array.isArray(diags) && diags.length) {
    return diags.map((d) => {
      const start = d.location?.start ?? {}
      const end = d.location?.end ?? start
      const line = start.line ?? 1
      const column = start.column ?? 1
      return {
        message: d.message ?? d.text ?? 'Syntax error',
        line,
        column,
        endLine: end.line ?? line,
        endColumn: end.column ?? column + 1,
      }
    })
  }
  const message = err instanceof Error ? err.message : String(err ?? 'Unknown error')
  return [{ message, line: 1, column: 1, endLine: 1, endColumn: 2 }]
}
