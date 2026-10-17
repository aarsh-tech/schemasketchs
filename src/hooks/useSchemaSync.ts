import { useEffect, useRef } from 'react'
import { parseDbml } from '@/lib/dbml/client'
import { useProjects } from '@/store/projects'
import { useUi } from '@/store/ui'

const DEBOUNCE_MS = 180

/** Parses the active project's DBML in a worker whenever it changes. */
export function useSchemaSync() {
  const activeId = useProjects((s) => s.activeId)
  const source = useProjects((s) => s.projects[s.activeId]?.source ?? '')
  const seq = useRef(0)
  const lastProject = useRef<string | null>(null)

  useEffect(() => {
    const ui = useUi.getState()
    const switched = lastProject.current !== activeId
    lastProject.current = activeId
    if (switched) ui.resetModel()

    const run = async () => {
      const mine = ++seq.current
      useUi.getState().setParsing(true)
      const { model, diagnostics } = await parseDbml(source)
      if (mine !== seq.current) return // a newer parse is on its way

      const prev = useUi.getState()
      if (model) {
        if (prev.modelProjectId === activeId) carryPositionsAcrossRename(prev.model.tables.map((t) => t.id), model.tables.map((t) => t.id))
        useProjects.getState().markGood(activeId, source)
        useUi.getState().setParseResult(activeId, model, diagnostics)
        return
      }

      // The source has errors. If nothing is on screen yet for this project
      // (fresh load, project switch), show the last version that worked.
      const lastGood = useProjects.getState().projects[activeId]?.lastGoodSource
      if (prev.modelProjectId !== activeId && lastGood && lastGood !== source) {
        const fallback = await parseDbml(lastGood)
        if (mine !== seq.current) return
        useUi.getState().setParseResult(activeId, fallback.model, diagnostics)
        return
      }
      useUi.getState().setParseResult(activeId, null, diagnostics)
    }

    // parse immediately when switching projects, debounce while typing
    const t = setTimeout(run, switched ? 0 : DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [activeId, source])
}

/**
 * Positions are keyed by table name. When the user renames exactly one table
 * between two parses, move its saved positions (and its place in any view) to
 * the new name so it doesn't jump across the canvas or drop out of a view.
 */
function carryPositionsAcrossRename(before: string[], after: string[]) {
  const b = new Set(before)
  const a = new Set(after)
  const removed = before.filter((id) => !a.has(id))
  const added = after.filter((id) => !b.has(id))
  if (removed.length !== 1 || added.length !== 1) return
  useProjects.getState().renameTableKey(removed[0], added[0])
}
