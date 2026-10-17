/// <reference lib="webworker" />
import ModelExporter from '@dbml-core-exporter'
import { compile, parseModel } from './compile'
import { EditError, applyEdit } from './edit'
import { toDiagnostics } from './normalize'
import type { ParseRequest, ParseResponse } from './protocol'

declare const self: DedicatedWorkerGlobalScope

function handle(req: ParseRequest): ParseResponse {
  if (req.type === 'edit') {
    try {
      return { id: req.id, type: 'edit', ok: true, text: applyEdit(req.source, req.edit) }
    } catch (err) {
      const message = err instanceof EditError ? err.message : `Couldn’t make that change: ${toDiagnostics(err)[0].message}`
      return { id: req.id, type: 'edit', ok: false, error: message }
    }
  }

  if (req.type === 'parse') return { id: req.id, type: 'parse', ...parseModel(req.source) }

  const { database, diagnostics } = compile(req.source)
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
