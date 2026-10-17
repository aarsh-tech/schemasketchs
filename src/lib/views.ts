import type { SchemaModel } from '@/lib/dbml/types'

/* Views: named subsets of one schema's tables, each with its own layout.
   The DBML stays the only schema; a view only lists table ids. Pure helpers. */

export interface XY {
  x: number
  y: number
}

export interface SchemaView {
  id: string
  name: string
  /** table node ids (name, or schema.name outside public) */
  tableIds: string[]
  /** node id → position, separate from the full diagram's layout */
  positions: Record<string, XY>
}

/** The part of the schema a view shows: its tables, the relationships between them, and their groups. */
export function viewModel(model: SchemaModel, tableIds: readonly string[]): SchemaModel {
  const keep = new Set(tableIds)
  const tables = model.tables.filter((t) => keep.has(t.id))
  const shown = new Set(tables.map((t) => t.id))
  return {
    ...model,
    tables,
    refs: model.refs.filter((r) => shown.has(r.source.tableId) && shown.has(r.target.tableId)),
    groups: model.groups.map((g) => ({ ...g, tableIds: g.tableIds.filter((id) => shown.has(id)) })).filter((g) => g.tableIds.length > 0),
    // sticky notes belong to the full diagram
    notes: [],
  }
}

/** Tables one relationship away from any of `tableIds`, not counting those already in it. */
export function neighbours(model: SchemaModel, tableIds: readonly string[]): string[] {
  const inView = new Set(tableIds)
  const out = new Set<string>()
  for (const r of model.refs) {
    const a = r.source.tableId
    const b = r.target.tableId
    if (inView.has(a) && !inView.has(b)) out.add(b)
    if (inView.has(b) && !inView.has(a)) out.add(a)
  }
  // keep the order the tables are written in
  return model.tables.map((t) => t.id).filter((id) => out.has(id))
}

/** Follow a table rename in every view. */
export function renameInViews(views: SchemaView[], from: string, to: string): SchemaView[] {
  let changed = false
  const next = views.map((v) => {
    if (!v.tableIds.includes(from)) return v
    changed = true
    const positions = { ...v.positions }
    if (positions[from] && !positions[to]) positions[to] = positions[from]
    delete positions[from]
    return { ...v, tableIds: v.tableIds.map((id) => (id === from ? to : id)), positions }
  })
  return changed ? next : views
}

function cleanPositions(raw: unknown): Record<string, XY> {
  const out: Record<string, XY> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const p = v as Partial<XY>
    if (typeof p?.x === 'number' && typeof p?.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)) out[k] = { x: Math.round(p.x), y: Math.round(p.y) }
  }
  return out
}

/** Views read from a file or link, with anything malformed dropped. */
export function cleanViews(raw: unknown): SchemaView[] {
  if (!Array.isArray(raw)) return []
  const out: SchemaView[] = []
  const ids = new Set<string>()
  for (const v of raw as Partial<SchemaView>[]) {
    if (!v || typeof v.name !== 'string' || !Array.isArray(v.tableIds)) continue
    let id = typeof v.id === 'string' && v.id ? v.id : `view${out.length + 1}`
    while (ids.has(id)) id = `${id}_`
    ids.add(id)
    out.push({
      id,
      name: v.name.slice(0, 60) || 'View',
      tableIds: [...new Set(v.tableIds.filter((t): t is string => typeof t === 'string'))],
      positions: cleanPositions(v.positions),
    })
  }
  return out
}
