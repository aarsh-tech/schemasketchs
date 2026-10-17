/// <reference lib="webworker" />
// This worker carries every SQL grammar @dbml/core ships (~2.7 MB gzipped),
// so it's only started the first time someone imports SQL.
import { importer } from '@dbml/core'
import { toDiagnostics } from './normalize'
import type { SqlRequest, SqlResponse } from './protocol'

declare const self: DedicatedWorkerGlobalScope

function describe(err: unknown): string {
  const [first] = toDiagnostics(err)
  return first.line > 1 || first.column > 1 ? `Line ${first.line}: ${first.message}` : first.message
}

self.onmessage = (event: MessageEvent<SqlRequest>) => {
  const { id, source, format } = event.data
  let res: SqlResponse
  try {
    res = { id, ok: true, text: importer.import(source, format) }
  } catch (err) {
    res = { id, ok: false, error: describe(err) }
  }
  self.postMessage(res)
}
