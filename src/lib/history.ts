import { createStore, del, get, set } from 'idb-keyval'
import type { XY } from '@/store/projects'

/**
 * Saved versions of a project's source and layout. They live in IndexedDB
 * (one record per project), not localStorage, because they add up quickly.
 */
export interface Version {
  id: string
  createdAt: number
  /** set for versions saved by hand; those are never pruned */
  label: string | null
  auto: boolean
  source: string
  positions: Record<string, XY>
  tableCount: number
}

/** Automatic snapshots kept per project. Labelled versions don't count towards it. */
export const AUTO_LIMIT = 100
/** How long editing has to pause before an automatic snapshot is taken. */
export const IDLE_MS = 30_000

/* ---------- pure helpers ---------- */

/** Versions are kept newest first. */
export function addVersion(list: Version[], v: Version, limit = AUTO_LIMIT): Version[] {
  const next = [v, ...list].sort((a, b) => b.createdAt - a.createdAt)
  let autos = 0
  return next.filter((x) => !x.auto || ++autos <= limit)
}

/** An automatic snapshot is only worth taking when the text differs from the newest version. */
export function needsSnapshot(list: Version[], source: string): boolean {
  if (!source.trim()) return false
  return list[0]?.source !== source
}

/** Change in table count against the version before it (older), or null for the first one. */
export function tableDelta(list: Version[], index: number): number | null {
  const older = list[index + 1]
  return older ? list[index].tableCount - older.tableCount : null
}

export function describeDelta(delta: number | null): string {
  if (delta === null) return 'first version'
  if (delta === 0) return 'same tables'
  const n = Math.abs(delta)
  return `${delta > 0 ? '+' : '−'}${n} ${n === 1 ? 'table' : 'tables'}`
}

/** Rough table count straight from the text, for when no parsed model is at hand. */
export function countTables(source: string): number {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  return code.match(/^\s*Table\s+[^\s{]/gim)?.length ?? 0
}

/* ---------- IndexedDB ---------- */

let db: ReturnType<typeof createStore> | null = null
const store = () => (db ??= createStore('schemasketch', 'history'))

export async function loadVersions(projectId: string): Promise<Version[]> {
  try {
    return ((await get<Version[]>(projectId, store())) ?? []).sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

export async function saveVersions(projectId: string, list: Version[]): Promise<void> {
  await set(projectId, list, store())
}

export async function deleteVersions(projectId: string): Promise<void> {
  try {
    await del(projectId, store())
  } catch {
    /* nothing to clean up */
  }
}
