import type { SchemaModel } from '@/lib/dbml/types'

/** Something worth a second look in a schema. Never an error: the schema still works. */
export interface Problem {
  rule: string
  /** where to point: a table, or one of its columns */
  tableId: string
  column: string | null
  message: string
}

export interface LintRule {
  id: string
  /** short name for the settings list */
  title: string
  /** one line on what it checks and why */
  description: string
  check: (model: SchemaModel) => Problem[]
}
