import type { SchemaModel } from '@/lib/dbml/types'

/* Search for the command palette, and neighbourhoods for focus mode. Pure. */

/**
 * How well `query` matches `text`, or -1 when it doesn't. Every query
 * character must appear in order; matches at the start, after a separator
 * (_ . space -) or at a camelCase hump, and runs of adjacent matches, score higher.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const lower = text.toLowerCase()
  if (lower === q) return 1000
  if (lower.startsWith(q)) return 900 - text.length
  const at = lower.indexOf(q)
  if (at >= 0) return 700 - at - text.length / 10

  let score = 0
  let ti = 0
  let prev = -2
  for (const ch of q) {
    if (ch === ' ') continue
    const found = lower.indexOf(ch, ti)
    if (found < 0) return -1
    const boundary = found === 0 || /[_.\s-]/.test(text[found - 1]) || (/[A-Z]/.test(text[found]) && /[a-z]/.test(text[found - 1] ?? ''))
    score += boundary ? 12 : 1
    if (found === prev + 1) score += 6
    prev = found
    ti = found + 1
  }
  return score - text.length / 20
}

export interface Searchable {
  label: string
  /** extra words that should also match, e.g. "png image download" */
  keywords?: string
}

/** Items matching `query`, best first; ties keep their original order. With no query, all of them. */
export function rank<T extends Searchable>(query: string, items: T[], limit = Infinity): T[] {
  if (!query.trim()) return items.slice(0, limit)
  return items
    .map((item, i) => {
      const own = fuzzyScore(query, item.label)
      const extra = item.keywords ? fuzzyScore(query, item.keywords) - 50 : -1
      return { item, i, score: Math.max(own, extra) }
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.item)
}

/**
 * Tables at most `depth` relationships away from `id` (including it),
 * mapped to their distance.
 */
export function tablesWithin(model: SchemaModel, id: string, depth: number): Map<string, number> {
  const adjacent = new Map<string, Set<string>>()
  const link = (a: string, b: string) => {
    if (!adjacent.has(a)) adjacent.set(a, new Set())
    adjacent.get(a)!.add(b)
  }
  for (const r of model.refs) {
    link(r.source.tableId, r.target.tableId)
    link(r.target.tableId, r.source.tableId)
  }
  const dist = new Map<string, number>([[id, 0]])
  let frontier = [id]
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next: string[] = []
    for (const t of frontier) {
      for (const n of adjacent.get(t) ?? []) {
        if (dist.has(n)) continue
        dist.set(n, d)
        next.push(n)
      }
    }
    frontier = next
  }
  return dist
}
