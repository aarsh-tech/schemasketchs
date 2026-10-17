/** A plain, serialisable description of a schema, produced by the parser worker. */

export interface FieldModel {
  name: string
  type: string
  pk: boolean
  unique: boolean
  notNull: boolean
  increment: boolean
  defaultValue: string | null
  note: string | null
  enumName: string | null
  /** true when the column takes part in at least one relationship */
  isRef: boolean
}

export interface TableModel {
  /** Stable key: "schema.table" (schema omitted for the default public schema) */
  id: string
  name: string
  schema: string | null
  alias: string | null
  note: string | null
  headerColor: string | null
  groupId: string | null
  fields: FieldModel[]
  /** names of composite indexes / unique constraints, shown as a footer count */
  indexCount: number
}

export type Cardinality = 'one' | 'zero-one' | 'many' | 'zero-many'

export interface RefEndpoint {
  tableId: string
  fields: string[]
  cardinality: Cardinality
}

export interface RefModel {
  id: string
  name: string | null
  source: RefEndpoint
  target: RefEndpoint
  onDelete: string | null
  onUpdate: string | null
}

export interface GroupModel {
  id: string
  name: string
  color: string | null
  note: string | null
  tableIds: string[]
}

export interface EnumModel {
  id: string
  name: string
  schema: string | null
  values: string[]
}

export interface StickyNoteModel {
  id: string
  name: string
  content: string
  color: string | null
}

export interface SchemaModel {
  databaseType: string | null
  projectName: string | null
  tables: TableModel[]
  refs: RefModel[]
  groups: GroupModel[]
  enums: EnumModel[]
  notes: StickyNoteModel[]
}

export interface ParseDiagnostic {
  message: string
  /** 1-based */
  line: number
  /** 1-based */
  column: number
  endLine: number
  endColumn: number
}

export type SqlDialect = 'postgres' | 'mysql' | 'mssql' | 'oracle'
export type ImportDialect = 'postgres' | 'mysql' | 'mssql' | 'snowflake' | 'oracle' | 'schemarb'

export const EMPTY_SCHEMA: SchemaModel = {
  databaseType: null,
  projectName: null,
  tables: [],
  refs: [],
  groups: [],
  enums: [],
  notes: [],
}

/** Node ids for sticky notes are prefixed so they never collide with table ids. */
export const NOTE_PREFIX = 'note:'
