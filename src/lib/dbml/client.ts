import type { SchemaEdit } from './edit'
import type { ParseRequest, ParseResponse, SqlRequest, SqlResponse } from './protocol'
import type { ImportDialect, ParseDiagnostic, SchemaModel, SqlDialect } from './types'

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

/**
 * Tiny promise-based RPC over a lazily created worker. If the worker crashes,
 * every pending call is rejected and a fresh worker is made on the next call.
 */
function rpc<Req extends { id: number }, Res extends { id: number }>(create: () => Worker, onCrash: (id: number, message: string) => Res) {
  let worker: Worker | null = null
  let seq = 0
  const pending = new Map<number, (r: Res) => void>()

  const get = () => {
    if (worker) return worker
    worker = create()
    worker.onmessage = (e: MessageEvent<Res>) => {
      const resolve = pending.get(e.data.id)
      pending.delete(e.data.id)
      resolve?.(e.data)
    }
    worker.onerror = (e) => {
      e.preventDefault()
      for (const [id, resolve] of pending) resolve(onCrash(id, e.message || 'The parser stopped unexpectedly'))
      pending.clear()
      worker?.terminate()
      worker = null
    }
    return worker
  }

  return (req: DistributiveOmit<Req, 'id'>): Promise<Res> => {
    const id = ++seq
    return new Promise((resolve) => {
      pending.set(id, resolve)
      get().postMessage({ ...req, id })
    })
  }
}

const parseRpc = rpc<ParseRequest, ParseResponse>(
  () => new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module', name: 'dbml-parse' }),
  (id, message) => ({ id, type: 'export', ok: false, error: message }),
)

const sqlRpc = rpc<SqlRequest, SqlResponse>(
  () => new Worker(new URL('./sql.worker.ts', import.meta.url), { type: 'module', name: 'dbml-sql' }),
  (id, message) => ({ id, ok: false, error: message }),
)

const crashDiag = (message: string): ParseDiagnostic[] => [{ message, line: 1, column: 1, endLine: 1, endColumn: 2 }]

export async function parseDbml(source: string): Promise<{ model: SchemaModel | null; diagnostics: ParseDiagnostic[] }> {
  const res = await parseRpc({ type: 'parse', source })
  if (res.type === 'parse') return { model: res.model, diagnostics: res.diagnostics }
  return { model: null, diagnostics: crashDiag(res.ok ? 'Unexpected response' : res.error) }
}

export async function exportSql(source: string, format: SqlDialect): Promise<string> {
  const res = await parseRpc({ type: 'export', source, format })
  if (res.type === 'export' && res.ok) return res.text
  throw new Error(res.type === 'export' && !res.ok ? res.error : 'Unexpected response')
}

/** Apply a canvas edit to DBML text. Throws with a message meant for the user. */
export async function editDbml(source: string, edit: SchemaEdit): Promise<string> {
  const res = await parseRpc({ type: 'edit', source, edit })
  if (res.type === 'edit' && res.ok) return res.text
  throw new Error(res.type !== 'parse' && !res.ok ? res.error : 'Unexpected response')
}

export async function importToDbml(source: string, format: ImportDialect): Promise<string> {
  const res = await sqlRpc({ source, format })
  if (res.ok) return res.text
  throw new Error(res.error)
}
