import { lintSchema } from '@/lib/lint'
import type { Problem } from '@/lib/lint'
import type { SchemaModel } from '@/lib/dbml/types'
import { useProjects } from '@/store/projects'
import { useUi } from '@/store/ui'

export interface Problems {
  list: Problem[]
  byTable: Map<string, Problem[]>
}

const NONE: string[] = []

// The editor, status bar and every table node ask for the same result, so lint once per change.
let last: { model: SchemaModel; off: readonly string[]; result: Problems } | null = null

function problemsFor(model: SchemaModel, off: readonly string[]): Problems {
  if (last && last.model === model && last.off === off) return last.result
  const list = lintSchema(model, off)
  const byTable = new Map<string, Problem[]>()
  for (const p of list) byTable.set(p.tableId, [...(byTable.get(p.tableId) ?? []), p])
  last = { model, off, result: { list, byTable } }
  return last.result
}

/** Lint findings for the schema on screen, minus the rules this project switched off. */
export function useProblems(): Problems {
  const model = useUi((s) => s.model)
  const off = useProjects((s) => s.projects[s.activeId]?.lintOff) ?? NONE
  return problemsFor(model, off)
}

/** Disabled rule ids for the active project. */
export const useLintOff = () => useProjects((s) => s.projects[s.activeId]?.lintOff) ?? NONE
