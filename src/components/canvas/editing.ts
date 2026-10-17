import { editSchema } from '@/lib/actions'
import type { RefEndpointSpec, TableRef } from '@/lib/dbml/edit'
import type { RefModel, SchemaModel, TableModel } from '@/lib/dbml/types'
import { uniqueName } from '@/lib/dbml/values'
import { neighbours } from '@/lib/views'
import type { SchemaView } from '@/lib/views'
import { toast } from 'sonner'
import { useCanvas } from '@/store/canvas'
import { activeViewOf, useProjects } from '@/store/projects'
import type { XY } from '@/store/projects'
import { useUi } from '@/store/ui'

/* ---------- handle ids for drawing relationships ---------- */

/** The dot you drag from to start a relationship. */
export const connectHandleId = (field: string, side: 'l' | 'r') => `${field}:c${side}`
/** The whole column row, which accepts a drop. */
export const dropHandleId = (field: string) => `${field}:drop`
export const isDropHandle = (id: string | null | undefined) => !!id?.endsWith(':drop')
/** Column name from any handle id (names may contain ':', the suffix never does). */
export const fieldOfHandle = (id: string | null | undefined) => (id ? id.slice(0, id.lastIndexOf(':')) : '')

/* ---------- model lookups ---------- */

export const findTable = (model: SchemaModel, id: string): TableModel | undefined => model.tables.find((t) => t.id === id)

export const toTableRef = (t: Pick<TableModel, 'schema' | 'name'>): TableRef => ({ schema: t.schema, name: t.name })

export function refEndpoints(model: SchemaModel, ref: RefModel): [RefEndpointSpec, RefEndpointSpec] | null {
  const s = findTable(model, ref.source.tableId)
  const t = findTable(model, ref.target.tableId)
  if (!s || !t) return null
  return [
    { table: toTableRef(s), fields: ref.source.fields },
    { table: toTableRef(t), fields: ref.target.fields },
  ]
}

/* ---------- actions ---------- */

export async function deleteRelationship(ref: RefModel) {
  const endpoints = refEndpoints(useUi.getState().model, ref)
  if (!endpoints) return
  await editSchema({ type: 'delete-ref', endpoints }, { done: 'Deleted the relationship', undoable: true })
}

/**
 * Add a table. With `at` it goes there; otherwise the canvas puts it in the
 * nearest free spot to the middle of the view. Its name is then ready to edit.
 */
export async function addTable(at?: XY) {
  const model = useUi.getState().model
  const name = uniqueName('new_table', model.tables.map((t) => t.name))
  const store = useProjects.getState()
  // a table added while a view is open belongs to that view
  const view = activeViewOf(store.projects[store.activeId])
  if (view) store.updateView(view.id, { tableIds: [...view.tableIds, name] })
  if (at) store.setPositions({ [name]: { x: Math.round(at.x), y: Math.round(at.y) } })
  const res = await editSchema({ type: 'add-table', name })
  if (res.ok) whenTableRendered(name, (el) => {
    const r = el.getBoundingClientRect()
    useCanvas.getState().open({ type: 'rename-table', tableId: name, x: r.left, y: r.bottom + 6 })
  })
}

/** Runs `cb` with the table's DOM node once the parsed model has it and React Flow has drawn it. */
function whenTableRendered(id: string, cb: (el: HTMLElement) => void) {
  const find = () => document.querySelector<HTMLElement>(`.schemasketch-flow .react-flow__node[data-id="${CSS.escape(id)}"]`)
  const ready = () => useUi.getState().model.tables.some((t) => t.id === id)
  let done = false
  const finish = () => {
    if (done) return
    done = true
    unsubscribe()
    clearTimeout(timeout)
    // two frames: one for React Flow to render, one for it to measure
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = find()
      if (el) cb(el)
    }))
  }
  const unsubscribe = useUi.subscribe((s) => {
    if (s.model.tables.some((t) => t.id === id)) finish()
  })
  const timeout = setTimeout(() => {
    done = true
    unsubscribe()
  }, 4000)
  if (ready()) finish()
}

/** Adds every table one relationship away from the view's tables. */
export function showRelated(view: SchemaView) {
  const extra = neighbours(useUi.getState().model, view.tableIds)
  if (!extra.length) {
    toast.success('Every related table is already in this view')
    return
  }
  useProjects.getState().updateView(view.id, { tableIds: [...view.tableIds, ...extra] })
  toast.success(`Added ${extra.length} related ${extra.length === 1 ? 'table' : 'tables'}`, { description: extra.join(', ') })
}

/* ---------- single click opens the column editor, double click jumps to code ---------- */

let clickTimer: ReturnType<typeof setTimeout> | undefined

export function openColumnSoon(tableId: string, column: string, row: HTMLElement) {
  clearTimeout(clickTimer)
  clickTimer = setTimeout(() => openColumn(tableId, column, row), 220)
}

export function openColumn(tableId: string, column: string | null, anchor: HTMLElement) {
  const r = anchor.getBoundingClientRect()
  useCanvas.getState().open({ type: 'column', tableId, column, x: r.right + 8, y: r.top - 6 })
}

export function cancelPendingClick() {
  clearTimeout(clickTimer)
}
