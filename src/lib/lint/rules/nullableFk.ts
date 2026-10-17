import type { LintRule, Problem } from '../types'
import { fieldOf, isManyToMany, isRequired, refSides, tableLabel, tableMap } from '../util'

export const nullableFk: LintRule = {
  id: 'nullable-fk',
  title: 'Nullability doesn’t match the relationship',
  description: 'A relationship drawn as required (>) needs a not null column; an optional one is written >?. Also catches “set null” on a not null column.',
  check(model) {
    const tables = tableMap(model)
    const out: Problem[] = []
    for (const ref of model.refs) {
      if (isManyToMany(ref)) continue
      const { child, parent } = refSides(ref, tables)
      const t = tables.get(child.tableId)
      if (!t) continue
      const fields = child.fields.map((n) => fieldOf(t, n)).filter((f) => !!f)
      if (!fields.length) continue
      const label = `${tableLabel(t)}.${fields.length === 1 ? fields[0].name : `(${fields.map((f) => f.name).join(', ')})`}`

      const nullable = fields.filter((f) => !isRequired(t, f))
      if (nullable.length && parent.cardinality === 'one') {
        out.push({
          rule: this.id,
          tableId: t.id,
          column: nullable[0].name,
          message: `${label} can be null, but the relationship says every row has one. Add [not null], or mark it optional with >? instead of >.`,
        })
      }
      const setNull = [ref.onDelete, ref.onUpdate].some((a) => a?.toLowerCase() === 'set null')
      const required = fields.filter((f) => isRequired(t, f))
      if (setNull && required.length) {
        out.push({
          rule: this.id,
          tableId: t.id,
          column: required[0].name,
          message: `${label} is not null, but the relationship sets it to null when the row it points at goes away, so that change would fail. Drop [not null] or pick another action.`,
        })
      }
    }
    return out
  },
}
