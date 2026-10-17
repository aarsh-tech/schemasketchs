import type { SchemaEdit } from './edit'
import type { ImportDialect, ParseDiagnostic, SchemaModel, SqlDialect } from './types'

/* parse worker: small, always loaded. Parses DBML, generates SQL from it and applies canvas edits. */
export type ParseRequest =
  | { id: number; type: 'parse'; source: string }
  | { id: number; type: 'export'; source: string; format: SqlDialect }
  | { id: number; type: 'edit'; source: string; edit: SchemaEdit }
export type ParseResponse =
  | { id: number; type: 'parse'; model: SchemaModel | null; diagnostics: ParseDiagnostic[] }
  | { id: number; type: 'export' | 'edit'; ok: true; text: string }
  | { id: number; type: 'export' | 'edit'; ok: false; error: string }

/* sql worker: large (every SQL grammar), loaded the first time someone imports SQL */
export type SqlRequest = { id: number; source: string; format: ImportDialect }
export type SqlResponse = { id: number; ok: true; text: string } | { id: number; ok: false; error: string }
