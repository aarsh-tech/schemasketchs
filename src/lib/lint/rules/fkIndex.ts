import type { LintRule, Problem } from '../types'
import { columnList, indexedColumnLists, isManyToMany, refSides, tableLabel, tableMap } from '../util'

/** Does an index start with exactly these columns (in any order)? */
const covered = (lists: string[][], cols: string[]) =>
  lists.some((l) => l.length >= cols.length && cols.every((c) => l.slice(0, cols.length).includes(c)))

export const fkIndex: LintRule = {
  id: 'fk-index',
  title: 'Foreign key without an index',
  description: 'Joins, and deletes on the referenced table, have to scan every row when the foreign key column has no index.',
  check(model) {
    // MySQL and MariaDB add these indexes themselves
    if (/mysql|maria/i.test(model.databaseType ?? '')) return []
    const tables = tableMap(model)
    const out: Problem[] = []
    const seen = new Set<string>()
    for (const ref of model.refs) {
      if (isManyToMany(ref)) continue
      const { child, parent } = refSides(ref, tables)
      const t = tables.get(child.tableId)
      if (!t || !child.fields.length) continue
      const key = `${t.id}:${[...child.fields].sort().join(',')}`
      if (seen.has(key) || covered(indexedColumnLists(t), child.fields)) continue
      seen.add(key)
      const p = tables.get(parent.tableId)
      const cols = columnList(child.fields)
      out.push({
        rule: this.id,
        tableId: t.id,
        column: child.fields[0],
        message: `${tableLabel(t)}.${cols} points at ${p ? tableLabel(p) : parent.tableId} but has no index. Add one in the table: indexes { ${cols} }`,
      })
    }
    return out
  },
}
