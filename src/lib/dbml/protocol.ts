import type { ImportDialect, ParseDiagnostic, SchemaModel, SqlDialect } from './types'

/* parse worker: small, always loaded. Parses DBML and generates SQL from it. */
export type ParseRequest =
  | { id: number; type: 'parse'; source: string }
  | { id: number; type: 'export'; source: string; format: SqlDialect }
export type ParseResponse =
  | { id: number; type: 'parse'; model: SchemaModel | null; diagnostics: ParseDiagnostic[] }
  | { id: number; type: 'export'; ok: true; text: string }
  | { id: number; type: 'export'; ok: false; error: string }

/* sql worker: large (every SQL grammar), loaded the first time someone imports SQL */
export type SqlRequest = { id: number; source: string; format: ImportDialect }
export type SqlResponse = { id: number; ok: true; text: string } | { id: number; ok: false; error: string }
