import type { LintRule } from '../types'
import { tableLabel } from '../util'

export const WIDE_TABLE_COLUMNS = 40

export const wideTable: LintRule = {
  id: 'wide-table',
  title: 'Very wide table',
  description: `Tables with more than ${WIDE_TABLE_COLUMNS} columns are usually several things in one, and are slow to read and change.`,
  check(model) {
    return model.tables
      .filter((t) => t.fields.length > WIDE_TABLE_COLUMNS)
      .map((t) => ({
        rule: this.id,
        tableId: t.id,
        column: null,
        message: `${tableLabel(t)} has ${t.fields.length} columns. Consider splitting rarely used or related columns into their own table.`,
      }))
  },
}
