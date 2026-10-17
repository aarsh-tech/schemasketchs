/// <reference lib="webworker" />
import Database from '@dbml-core-database'
import ModelExporter from '@dbml-core-exporter'
import { Compiler, DEFAULT_ENTRY, MemoryProjectLayout } from '@dbml/parse'
import { toDiagnostics, toSchemaModel } from './normalize'
import type { ParseRequest, ParseResponse } from './protocol'
import type { ParseDiagnostic } from './types'

declare const self: DedicatedWorkerGlobalScope

interface CompilerDiag {
  diagnostic: string
  nodeOrToken: { startPos: { line: number; column: number }; endPos: { line: number; column: number } }
}

type Compiled = { database: Database; diagnostics: [] } | { database: null; diagnostics: ParseDiagnostic[] }

function compile(source: string): Compiled {
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

function handle(req: ParseRequest): ParseResponse {
  const { database, diagnostics } = compile(req.source)

  if (req.type === 'parse') {
    if (!database) return { id: req.id, type: 'parse', model: null, diagnostics }
    try {
      const model = toSchemaModel(database.normalize() as Parameters<typeof toSchemaModel>[0])
      return { id: req.id, type: 'parse', model, diagnostics: [] }
    } catch (err) {
      return { id: req.id, type: 'parse', model: null, diagnostics: toDiagnostics(err) }
    }
  }

  if (!database) {
    const d = diagnostics[0]
    return { id: req.id, type: 'export', ok: false, error: `The schema has an error on line ${d?.line ?? 1}: ${d?.message ?? 'unknown'}` }
  }
  try {
    return { id: req.id, type: 'export', ok: true, text: ModelExporter.export(database, req.format) }
  } catch (err) {
    return { id: req.id, type: 'export', ok: false, error: toDiagnostics(err)[0].message }
  }
}

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  self.postMessage(handle(event.data))
}
