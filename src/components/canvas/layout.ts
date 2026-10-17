import type { Node } from '@xyflow/react'
import type { SchemaModel } from '@/lib/dbml/types'
import type { XY } from '@/store/projects'

export const TABLE_WIDTH = 248
export const HEADER_H = 38
export const ROW_H = 28
export const NOTE_WIDTH = 240
export const GROUP_PAD = 28
export const GROUP_LABEL_H = 30

export function sizeOf(node: Node): { width: number; height: number } {
  return {
    width: node.measured?.width ?? node.width ?? TABLE_WIDTH,
    height: node.measured?.height ?? node.height ?? HEADER_H + ROW_H * 4,
  }
}

interface ElkNode {
  id: string
  width?: number
  height?: number
  x?: number
  y?: number
  children?: ElkNode[]
  layoutOptions?: Record<string, string>
}

/**
 * Arrange tables with ELK's layered algorithm. Members of a TableGroup are
 * laid out inside a compound node so they stay together.
 * Returns absolute top-left positions keyed by node id.
 */
export async function autoLayout(model: SchemaModel, nodes: Node[]): Promise<Record<string, XY>> {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
  const elk = new ELK()

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const leaf = (id: string): ElkNode => ({ id, ...sizeOf(byId.get(id)!) })

  const grouped = new Set<string>()
  const groupNodes: ElkNode[] = model.groups
    .map((g) => {
      const members = g.tableIds.filter((id) => byId.has(id))
      members.forEach((m) => grouped.add(m))
      return {
        id: g.id,
        layoutOptions: {
          'elk.padding': `[top=${GROUP_PAD + GROUP_LABEL_H},left=${GROUP_PAD},bottom=${GROUP_PAD},right=${GROUP_PAD}]`,
        },
        children: members.map(leaf),
      }
    })
    .filter((g) => g.children.length > 0)

  const tableIds = model.tables.map((t) => t.id).filter((id) => byId.has(id))
  const loose = tableIds.filter((id) => !grouped.has(id)).map(leaf)

  const seen = new Set<string>()
  const edges = model.refs
    .filter((r) => byId.has(r.source.tableId) && byId.has(r.target.tableId) && r.source.tableId !== r.target.tableId)
    .map((r) => ({ id: r.id, sources: [r.target.tableId], targets: [r.source.tableId] }))
    .filter((e) => {
      const k = `${e.sources[0]}→${e.targets[0]}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })

  const graph = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '96',
      'elk.spacing.nodeNode': '56',
      'elk.spacing.componentComponent': '90',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: [...groupNodes, ...loose],
    edges,
  })

  const out: Record<string, XY> = {}
  const walk = (n: ElkNode, ox: number, oy: number) => {
    const x = (n.x ?? 0) + ox
    const y = (n.y ?? 0) + oy
    if (n.children?.length) n.children.forEach((c) => walk(c, x, y))
    else if (n.id !== 'root') out[n.id] = { x: Math.round(x), y: Math.round(y) }
  }
  graph.children?.forEach((c) => walk(c as ElkNode, 0, 0))

  // sticky notes go in a row underneath everything else
  const placed = Object.entries(out)
  const left = placed.length ? Math.min(...placed.map(([, p]) => p.x)) : 0
  const bottom = placed.length ? Math.max(...placed.map(([id, p]) => p.y + sizeOf(byId.get(id)!).height)) : 0
  let x = left
  for (const n of nodes) {
    if (n.type !== 'note') continue
    out[n.id] = { x, y: bottom + 80 }
    x += sizeOf(n).width + 40
  }
  return out
}

/** Bounding box of a set of nodes (absolute coordinates). */
export function boundsOf(nodes: Node[]) {
  if (!nodes.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    const { width, height } = sizeOf(n)
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
    maxX = Math.max(maxX, n.position.x + width)
    maxY = Math.max(maxY, n.position.y + height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

type Rect = { x: number; y: number; width: number; height: number }

/**
 * Finds the free spot closest to `near` for a box of the given size,
 * scanning outward in rings so new tables don't land on top of old ones.
 */
export function findFreeSpot(near: XY, size: { width: number; height: number }, taken: Rect[], gap = 32): XY {
  const hits = (x: number, y: number) =>
    taken.some((r) => x < r.x + r.width + gap && x + size.width + gap > r.x && y < r.y + r.height + gap && y + size.height + gap > r.y)
  const step = 48
  const start = { x: Math.round(near.x - size.width / 2), y: Math.round(near.y - size.height / 2) }
  if (!hits(start.x, start.y)) return start
  for (let ring = 1; ring < 60; ring++) {
    const candidates: XY[] = []
    for (let i = -ring; i <= ring; i++) {
      candidates.push({ x: start.x + i * step, y: start.y - ring * step }, { x: start.x + i * step, y: start.y + ring * step })
      candidates.push({ x: start.x - ring * step, y: start.y + i * step }, { x: start.x + ring * step, y: start.y + i * step })
    }
    candidates.sort((a, b) => Math.hypot(a.x - start.x, a.y - start.y) - Math.hypot(b.x - start.x, b.y - start.y))
    const free = candidates.find((c) => !hits(c.x, c.y))
    if (free) return free
  }
  return start
}
