import Database from '@dbml-core-database'
import { Compiler, DEFAULT_ENTRY, MemoryProjectLayout } from '@dbml/parse'
import { toDiagnostics, toSchemaModel } from './normalize'
import type { ParseDiagnostic, SchemaModel } from './types'

/* Worker-only (and tests): pulls in the DBML compiler. Never import this from the main thread. */

interface CompilerDiag {
  diagnostic: string
  nodeOrToken: { startPos: { line: number; column: number }; endPos: { line: number; column: number } }
}

export type Compiled = { database: Database; diagnostics: [] } | { database: null; diagnostics: ParseDiagnostic[] }

export function compile(source: string): Compiled {
  try {
    const layout = new MemoryProjectLayout()
    layout.setSource(DEFAULT_ENTRY, source)
    const compiler = new Compiler(layout)
    const errors = compiler.parse.errors(DEFAULT_ENTRY) as unknown as CompilerDiag[]
    if (errors.length) {
      return {
        database: null,
        diagnostics: errors.map((e) => ({
          message: e.diagnostic,
          line: e.nodeOrToken.startPos.line + 1,
          column: e.nodeOrToken.startPos.column + 1,
          endLine: e.nodeOrToken.endPos.line + 1,
          endColumn: e.nodeOrToken.endPos.column + 1,
        })),
      }
    }
    return { database: new Database(compiler.parse.rawDb(DEFAULT_ENTRY)), diagnostics: [] }
  } catch (err) {
    return { database: null, diagnostics: toDiagnostics(err) }
  }
}

export function parseModel(source: string): { model: SchemaModel | null; diagnostics: ParseDiagnostic[] } {
  const { database, diagnostics } = compile(source)
  if (!database) return { model: null, diagnostics }
  try {
    return { model: toSchemaModel(database.normalize() as Parameters<typeof toSchemaModel>[0]), diagnostics: [] }
  } catch (err) {
    return { model: null, diagnostics: toDiagnostics(err) }
  }
}
