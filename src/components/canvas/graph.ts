import type { Edge, Node } from '@xyflow/react'
import type { Cardinality, FieldModel, GroupModel, RefModel, SchemaModel, StickyNoteModel, TableModel } from '@/lib/dbml/types'
import { NOTE_PREFIX } from '@/lib/dbml/types'
import type { DetailLevel } from '@/store/ui'
import type { XY } from '@/store/projects'
import { GROUP_LABEL_H, GROUP_PAD, HEADER_H, NOTE_WIDTH, ROW_H, TABLE_WIDTH, boundsOf, sizeOf } from './layout'

export type Highlight = 'focus' | 'related' | null

export type TableNodeData = {
  table: TableModel
  fields: FieldModel[]
  hiddenCount: number
  color: string
  highlight: Highlight
}
export type NoteNodeData = { note: StickyNoteModel }
export type GroupNodeData = { group: GroupModel; color: string }

export type TableNode = Node<TableNodeData, 'table'>
export type NoteNode = Node<NoteNodeData, 'note'>
export type GroupNode = Node<GroupNodeData, 'tableGroup'>
export type AnyNode = TableNode | NoteNode | GroupNode

export type RelationEdgeData = {
  ref: RefModel
  sourceCardinality: Cardinality
  targetCardinality: Cardinality
  active: boolean
  selfLoop: boolean
}
export type RelationEdge = Edge<RelationEdgeData, 'relation'>

export const DEFAULT_TABLE_COLOR = 'var(--c-accent)'

export function visibleFields(table: TableModel, detail: DetailLevel): FieldModel[] {
  if (detail === 'name') return []
  if (detail === 'keys') return table.fields.filter((f) => f.pk || f.isRef)
  return table.fields
}

/** Handle id for a column (or the table header when the column is hidden). */
export const handleId = (field: string | null, side: 'l' | 'r', kind: 's' | 't') =>
  `${field ?? '__table'}:${side}:${kind}`

/* ---------- nodes ---------- */

export function buildNodes(
  model: SchemaModel,
  detail: DetailLevel,
  positions: Record<string, XY>,
  existing: Map<string, AnyNode>,
  placeNew: (id: string, size: { width: number; height: number }, taken: { x: number; y: number; width: number; height: number }[]) => XY,
): { nodes: AnyNode[]; placed: Record<string, XY> } {
  const groupColor = new Map(model.groups.map((g) => [g.id, g.color]))
  const placed: Record<string, XY> = {}

  // everything that already has a place, so new boxes can avoid it
  const taken = [...existing.values()]
    .filter((n) => n.type !== 'tableGroup')
    .map((n) => ({ ...n.position, ...sizeOf(n) }))
  const estimate = (id: string) => {
    const t = model.tables.find((x) => x.id === id)
    if (!t) return { width: NOTE_WIDTH, height: 120 }
    return { width: TABLE_WIDTH, height: HEADER_H + ROW_H * visibleFields(t, detail).length + 4 }
  }

  const position = (id: string): XY => {
    const prev = existing.get(id)
    if (prev) return prev.position
    if (positions[id]) return positions[id]
    const size = estimate(id)
    const p = placeNew(id, size, taken)
    taken.push({ ...p, ...size })
    placed[id] = p
    return p
  }

  const tables: TableNode[] = model.tables.map((table) => {
    const fields = visibleFields(table, detail)
    const prev = existing.get(table.id) as TableNode | undefined
    const color = table.headerColor ?? (table.groupId ? groupColor.get(table.groupId) : null) ?? DEFAULT_TABLE_COLOR
    return {
      ...(prev ?? {}),
      id: table.id,
      type: 'table',
      position: position(table.id),
      data: { table, fields, hiddenCount: table.fields.length - fields.length, color, highlight: null },
      // the Delete key only removes relationships; tables are deleted from their menu
      deletable: false,
      zIndex: 1,
    }
  })

  const notes: NoteNode[] = model.notes.map((note) => {
    const prev = existing.get(note.id) as NoteNode | undefined
    return {
      ...(prev ?? {}),
      id: note.id,
      type: 'note',
      position: position(note.id),
      data: { note },
      width: NOTE_WIDTH,
      deletable: false,
      zIndex: 1,
    }
  })

  const groups = buildGroups(model, tables)
  return { nodes: [...groups, ...tables, ...notes], placed }
}

/** Groups are drawn as a tinted area behind their member tables. */
export function buildGroups(model: SchemaModel, tableNodes: AnyNode[]): GroupNode[] {
  const byId = new Map(tableNodes.map((n) => [n.id, n]))
  const out: GroupNode[] = []
  for (const group of model.groups) {
    const members = group.tableIds.map((id) => byId.get(id)).filter((n): n is AnyNode => !!n)
    const b = boundsOf(members)
    if (!b) continue
    out.push({
      id: group.id,
      type: 'tableGroup',
      position: { x: b.x - GROUP_PAD, y: b.y - GROUP_PAD - GROUP_LABEL_H },
      width: b.width + GROUP_PAD * 2,
      height: b.height + GROUP_PAD * 2 + GROUP_LABEL_H,
      data: { group, color: group.color ?? 'var(--c-ink-3)' },
      draggable: false,
      selectable: false,
      focusable: false,
      deletable: false,
      zIndex: 0,
    })
  }
  return out
}

/** Recompute group rectangles after table nodes moved; keeps object identity when nothing changed. */
export function refreshGroups(model: SchemaModel, nodes: AnyNode[]): AnyNode[] {
  if (!model.groups.length) return nodes
  const fresh = new Map(buildGroups(model, nodes.filter((n) => n.type === 'table')).map((g) => [g.id, g]))
  let changed = false
  const next = nodes.map((n) => {
    if (n.type !== 'tableGroup') return n
    const g = fresh.get(n.id)
    if (!g) return n
    if (g.position.x === n.position.x && g.position.y === n.position.y && g.width === n.width && g.height === n.height) return n
    changed = true
    return { ...n, position: g.position, width: g.width, height: g.height }
  })
  return changed ? next : nodes
}

/* ---------- edges ---------- */

export function buildEdges(model: SchemaModel, nodes: AnyNode[], focusId: string | null): RelationEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const edges: RelationEdge[] = []

  for (const ref of model.refs) {
    const s = byId.get(ref.source.tableId) as TableNode | undefined
    const t = byId.get(ref.target.tableId) as TableNode | undefined
    if (!s || !t) continue

    const sField = s.data.fields.some((f) => f.name === ref.source.fields[0]) ? ref.source.fields[0] : null
    const tField = t.data.fields.some((f) => f.name === ref.target.fields[0]) ? ref.target.fields[0] : null

    const selfLoop = s.id === t.id
    const sw = sizeOf(s).width
    const tw = sizeOf(t).width
    const sCenter = s.position.x + sw / 2
    const tCenter = t.position.x + tw / 2
    let sSide: 'l' | 'r'
    let tSide: 'l' | 'r'
    if (selfLoop) {
      sSide = 'r'
      tSide = 'r'
    } else if (s.position.x + sw + 40 < t.position.x) {
      sSide = 'r'
      tSide = 'l'
    } else if (t.position.x + tw + 40 < s.position.x) {
      sSide = 'l'
      tSide = 'r'
    } else {
      // stacked vertically: route around the side that's closer
      sSide = tCenter >= sCenter ? 'r' : 'l'
      tSide = sSide
    }

    const active = !!focusId && (s.id === focusId || t.id === focusId)
    edges.push({
      id: ref.id,
      type: 'relation',
      source: s.id,
      target: t.id,
      sourceHandle: handleId(sField, sSide, 's'),
      targetHandle: handleId(tField, tSide, 't'),
      data: {
        ref,
        sourceCardinality: ref.source.cardinality,
        targetCardinality: ref.target.cardinality,
        active,
        selfLoop,
      },
      className: focusId && !active ? 'is-dimmed' : undefined,
      zIndex: 0,
      focusable: true,
    })
  }
  return edges
}

/** Tables directly connected to `id`. */
export function relatedTables(model: SchemaModel, id: string): Set<string> {
  const out = new Set<string>([id])
  for (const r of model.refs) {
    if (r.source.tableId === id) out.add(r.target.tableId)
    if (r.target.tableId === id) out.add(r.source.tableId)
  }
  return out
}

export const isNoteId = (id: string) => id.startsWith(NOTE_PREFIX)

/* ---------- table card text ---------- */

export function describeField(f: FieldModel): string {
  const bits = [`${f.name}  ${f.type}`]
  const flags = [
    f.pk && 'primary key',
    f.increment && 'auto increment',
    f.unique && 'unique',
    f.notNull && 'not null',
    f.defaultValue && `default ${f.defaultValue}`,
  ].filter(Boolean)
  if (flags.length) bits.push(flags.join(', '))
  if (f.note) bits.push(f.note)
  return bits.join('\n')
}

export const ROW_CLASS = 'ss-row relative flex items-center gap-2 border-t border-line/70 px-3 text-[12.5px]'
