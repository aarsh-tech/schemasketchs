import type { LintRule, Problem } from '../types'
import { tableLabel } from '../util'

type Style = 'snake_case' | 'camelCase' | 'PascalCase' | 'kebab-case'

/** The naming style a name shows, or null when it doesn't show one ("id", "email", "URL"). */
export function styleOf(name: string): Style | null {
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(name)) return 'snake_case'
  if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(name)) return 'kebab-case'
  if (/^[a-z][a-z0-9]*([A-Z][a-z0-9]*)+$/.test(name)) return 'camelCase'
  if (/^[A-Z][a-z0-9]+([A-Z][a-z0-9]*)*$/.test(name) && /[a-z]/.test(name)) return /^[A-Z][a-z0-9]+$/.test(name) ? null : 'PascalCase'
  return null
}

const words = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())

export function restyle(name: string, style: Style): string {
  const w = words(name)
  if (style === 'snake_case') return w.join('_')
  if (style === 'kebab-case') return w.join('-')
  const cap = w.map((x) => x[0].toUpperCase() + x.slice(1))
  return style === 'PascalCase' ? cap.join('') : w[0] + cap.slice(1).join('')
}

/** The style most names use; null when there's no clear winner. */
function dominant(names: string[]): Style | null {
  const counts = new Map<Style, number>()
  for (const n of names) {
    const s = styleOf(n)
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1)
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1])
  if (ranked.length < 2 || ranked[0][1] === ranked[1][1]) return null
  return ranked[0][0]
}

export const mixedNaming: LintRule = {
  id: 'naming',
  title: 'Mixed naming styles',
  description: 'Mixing user_id and userId makes names hard to guess. Tables and columns are checked separately, so User with user_id is fine.',
  check(model) {
    const out: Problem[] = []
    const tableStyle = dominant(model.tables.map((t) => t.name))
    if (tableStyle) {
      for (const t of model.tables) {
        const s = styleOf(t.name)
        if (s && s !== tableStyle) {
          out.push({ rule: this.id, tableId: t.id, column: null, message: `Table ${tableLabel(t)} is ${s}, but most tables use ${tableStyle}: ${restyle(t.name, tableStyle)}` })
        }
      }
    }
    const columnStyle = dominant(model.tables.flatMap((t) => t.fields.map((f) => f.name)))
    if (columnStyle) {
      for (const t of model.tables) {
        for (const f of t.fields) {
          const s = styleOf(f.name)
          if (s && s !== columnStyle) {
            out.push({
              rule: this.id,
              tableId: t.id,
              column: f.name,
              message: `${tableLabel(t)}.${f.name} is ${s}, but most columns use ${columnStyle}: ${restyle(f.name, columnStyle)}`,
            })
          }
        }
      }
    }
    return out
  },
}
