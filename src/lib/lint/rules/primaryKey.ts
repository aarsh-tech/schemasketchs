import type { LintRule } from '../types'
import { primaryKey, tableLabel } from '../util'

export const missingPrimaryKey: LintRule = {
  id: 'primary-key',
  title: 'Table without a primary key',
  description: 'Without a primary key, rows can’t be told apart reliably, and most ORMs and replication tools refuse the table.',
  check(model) {
    return model.tables
      .filter((t) => primaryKey(t).length === 0)
      .map((t) => ({
        rule: this.id,
        tableId: t.id,
        column: null,
        message: `${tableLabel(t)} has no primary key. Mark a column with [pk], or add (a, b) [pk] under indexes.`,
      }))
  },
}
