import { parseType } from '@/lib/convert/shared'
import type { FieldModel } from '@/lib/dbml/types'
import type { LintRule, Problem } from '../types'
import { fieldOf, isManyToMany, refSides, tableLabel, tableMap } from '../util'

// serial types are integers with a sequence; a foreign key to one is a plain integer
const SAME: Record<string, string> = { serial: 'integer', serial4: 'integer', smallserial: 'smallint', serial2: 'smallint', bigserial: 'bigint', serial8: 'bigint' }

/** A column type reduced to what has to match across a relationship (length and precision don't). */
export function comparableType(f: FieldModel): string {
  if (f.enumName) return `enum:${f.enumName}`
  const { base, array } = parseType(f.type)
  return `${SAME[base] ?? base}${array ? '[]' : ''}`
}

export const refTypes: LintRule = {
  id: 'ref-types',
  title: 'Relationship between different types',
  description: 'Both ends of a relationship should have the same type, or the database can’t use an index for the join, or refuses the key.',
  check(model) {
    const tables = tableMap(model)
    const out: Problem[] = []
    for (const ref of model.refs) {
      if (isManyToMany(ref)) continue
      const { child, parent } = refSides(ref, tables)
      const ct = tables.get(child.tableId)
      const pt = tables.get(parent.tableId)
      if (!ct || !pt) continue
      child.fields.forEach((name, i) => {
        const a = fieldOf(ct, name)
        const b = fieldOf(pt, parent.fields[i] ?? '')
        if (!a || !b || comparableType(a) === comparableType(b)) return
        out.push({
          rule: this.id,
          tableId: ct.id,
          column: a.name,
          message: `${tableLabel(ct)}.${a.name} is ${a.type} but it points at ${tableLabel(pt)}.${b.name}, which is ${b.type}. Use the same type on both sides.`,
        })
      })
    }
    return out
  },
}
