import { Code, Crosshair, EyeOff, Grid2x2Plus, Layers, ListPlus, LoaderCircle, Maximize, Network, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useId, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { COLUMN_TYPES } from '@/components/editor/dbmlTools'
import { Button, ContextMenu, Popover } from '@/components/ui/primitives'
import type { MenuEntry } from '@/components/ui/primitives'
import { editSchema } from '@/lib/actions'
import { cx } from '@/lib/cx'
import type { ColumnPatch, RefOp } from '@/lib/dbml/edit'
import type { FieldModel, TableModel } from '@/lib/dbml/types'
import { toDbmlDefault } from '@/lib/dbml/values'
import { HEADER_COLORS } from '@/lib/palette'
import { useCanvas } from '@/store/canvas'
import { activeViewOf, useProjects } from '@/store/projects'
import type { CanvasOverlay } from '@/store/canvas'
import { useUi } from '@/store/ui'
import { addTable, findTable, showRelated, toTableRef } from './editing'

type Of<T extends CanvasOverlay['type']> = Extract<CanvasOverlay, { type: T }>

/** Menus and small editors that float over the canvas. One at a time. */
export function CanvasOverlays() {
  const overlay = useCanvas((s) => s.overlay)
  const model = useUi((s) => s.model)
  if (!overlay) return null
  // remount per overlay so each starts from fresh state
  const key = JSON.stringify(overlay)

  if (overlay.type === 'pane-menu') return <PaneMenu key={key} overlay={overlay} />
  if (overlay.type === 'new-ref') return <NewRefMenu key={key} overlay={overlay} />
  const table = findTable(model, overlay.tableId)
  if (!table) return null
  if (overlay.type === 'table-menu') return <TableMenu key={key} overlay={overlay} table={table} />
  if (overlay.type === 'rename-table') return <RenameTable key={key} overlay={overlay} table={table} />
  const field = overlay.column === null ? null : table.fields.find((f) => f.name === overlay.column)
  if (overlay.column !== null && !field) return null
  return <ColumnEditor key={key} overlay={overlay} table={table} field={field ?? null} />
}

const close = () => useCanvas.getState().close()
const label = (t: Pick<TableModel, 'schema' | 'name'>) => (t.schema ? `${t.schema}.${t.name}` : t.name)

/* ---------- table menu ---------- */

function TableMenu({ overlay, table }: { overlay: Of<'table-menu'>; table: TableModel }) {
  const { x, y } = overlay
  const ref = toTableRef(table)
  const items: MenuEntry[] = [
    { heading: label(table) },
    { label: 'Rename table…', icon: <Pencil size={14} />, onSelect: () => useCanvas.getState().open({ type: 'rename-table', tableId: table.id, x, y }) },
    { label: 'Add column…', icon: <ListPlus size={14} />, onSelect: () => useCanvas.getState().open({ type: 'column', tableId: table.id, column: null, x, y }) },
    { label: 'Show in code', icon: <Code size={14} />, onSelect: () => useUi.getState().revealTable(table.id) },
    {
      label: 'Focus on this table',
      icon: <Crosshair size={14} />,
      onSelect: () => {
        const cur = useUi.getState().focus
        useUi.getState().setFocus({ tableId: table.id, depth: cur?.depth ?? 1, hide: cur?.hide ?? false })
      },
    },
    ...viewItems(table),
    'separator',
    {
      label: 'Delete table',
      icon: <Trash2 size={14} />,
      danger: true,
      onSelect: () => void editSchema({ type: 'delete-table', table: ref }, { done: `Deleted ${label(table)}`, undoable: true }),
    },
  ]
  const setColor = (color: string | null) => {
    close()
    void editSchema({ type: 'set-header-color', table: ref, color })
  }
  const current = table.headerColor?.toLowerCase() ?? null

  return (
    <ContextMenu x={x} y={y} items={items} label={`Actions for ${label(table)}`} onClose={close} width={244}>
      <div className="mt-1 border-t border-line px-2.5 pt-2 pb-1.5">
        <div className="mb-1.5 text-[11.5px] font-medium text-ink-3">Header colour</div>
        <div className="flex flex-wrap gap-1.5">
          <Swatch name="Default" pressed={current === null} onClick={() => setColor(null)} className="bg-accent" />
          {HEADER_COLORS.map((c) => (
            <Swatch key={c.hex} name={c.name} pressed={current === c.hex.toLowerCase()} onClick={() => setColor(c.hex)} style={{ background: c.hex }} />
          ))}
        </div>
      </div>
    </ContextMenu>
  )
}

/** Move a table in or out of views without touching the schema. */
function viewItems(table: TableModel): MenuEntry[] {
  const store = useProjects.getState()
  const project = store.projects[store.activeId]
  const view = activeViewOf(project)
  if (view) {
    return [
      'separator',
      { label: 'Remove from this view', icon: <EyeOff size={14} />, onSelect: () => store.updateView(view.id, { tableIds: view.tableIds.filter((id) => id !== table.id) }) },
      { label: 'Show related tables', icon: <Network size={14} />, onSelect: () => showRelated({ ...view, tableIds: [...new Set([...view.tableIds, table.id])] }) },
    ]
  }
  const others = (project?.views ?? []).filter((v) => !v.tableIds.includes(table.id)).slice(0, 5)
  if (!others.length) return []
  return [
    'separator',
    ...others.map(
      (v): MenuEntry => ({
        label: `Add to ${v.name}`,
        icon: <Layers size={14} />,
        onSelect: () => {
          store.updateView(v.id, { tableIds: [...v.tableIds, table.id] })
          toast.success(`Added ${label(table)} to the ${v.name} view`)
        },
      }),
    ),
  ]
}

function Swatch({ name, pressed, onClick, className, style }: { name: string; pressed: boolean; onClick: () => void; className?: string; style?: CSSProperties }) {
  return (
    <button
      type="button"
      aria-label={`${name} header colour`}
      aria-pressed={pressed}
      title={name}
      onClick={onClick}
      style={style}
      className={cx('h-6 w-6 rounded-md border border-ink/15 ring-offset-2 ring-offset-raised', pressed && 'ring-2 ring-ink', className)}
    />
  )
}

/* ---------- empty canvas menu ---------- */

function PaneMenu({ overlay }: { overlay: Of<'pane-menu'> }) {
  const ui = useUi.getState()
  const items: MenuEntry[] = [
    { label: 'Add table here', icon: <Grid2x2Plus size={14} />, onSelect: () => void addTable(overlay.flow) },
    'separator',
    { label: 'Arrange tables automatically', icon: <Network size={14} />, onSelect: ui.requestLayout },
    { label: 'Fit diagram to screen', icon: <Maximize size={14} />, onSelect: ui.requestFit },
  ]
  return <ContextMenu x={overlay.x} y={overlay.y} items={items} label="Canvas actions" onClose={close} />
}

/* ---------- small forms ---------- */

function useSubmit(run: () => Promise<{ ok: boolean; error?: string }>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await run()
    setBusy(false)
    if (res.ok) close()
    else setError(res.error ?? 'Something went wrong.')
  }
  return { busy, error, submit }
}

function FormError({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="mt-2 rounded-md bg-danger-soft px-2.5 py-1.5 text-[12px] leading-snug text-danger">
      {error}
    </p>
  ) : null
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-[12px] font-medium text-ink-2">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-[11.5px] leading-snug text-ink-3">{hint}</p> : null}
    </div>
  )
}

const inputClass = 'h-8 w-full rounded-md border border-line-strong bg-panel px-2 font-mono text-[12.5px] text-ink outline-none focus:border-accent'

/* ---------- rename ---------- */

function RenameTable({ overlay, table }: { overlay: Of<'rename-table'>; table: TableModel }) {
  const [name, setName] = useState(table.name)
  const id = useId()
  const { busy, error, submit } = useSubmit(() => editSchema({ type: 'rename-table', table: toTableRef(table), name }, { quiet: true }))
  return (
    <Popover x={overlay.x} y={overlay.y} label={`Rename ${label(table)}`} onClose={close} width={280}>
      <form onSubmit={submit} className="p-3">
        <Field label="Table name" htmlFor={id}>
          <input id={id} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} autoComplete="off" spellCheck={false} />
        </Field>
        <FormError error={error} />
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" onClick={close}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit" disabled={busy || !name.trim()}>
            {busy ? <LoaderCircle size={13} className="animate-spin" /> : null}
            Rename table
          </Button>
        </div>
      </form>
    </Popover>
  )
}

/* ---------- column editor ---------- */

interface ColumnForm {
  name: string
  type: string
  pk: boolean
  unique: boolean
  notNull: boolean
  defaultValue: string
}

const formOf = (f: FieldModel | null): ColumnForm => ({
  name: f?.name ?? '',
  type: f?.type ?? 'varchar',
  pk: f?.pk ?? false,
  unique: f?.unique ?? false,
  notNull: f?.notNull ?? false,
  defaultValue: f?.defaultValue ?? '',
})

function ColumnEditor({ overlay, table, field }: { overlay: Of<'column'>; table: TableModel; field: FieldModel | null }) {
  const initial = formOf(field)
  const [form, setForm] = useState(initial)
  const enums = useUi((s) => s.model.enums)
  const ids = { name: useId(), type: useId(), dflt: useId(), types: useId() }
  const set = <K extends keyof ColumnForm>(k: K, v: ColumnForm[K]) => setForm((f) => ({ ...f, [k]: v }))
  const ref = toTableRef(table)
  const isNew = field === null

  const { busy, error, submit } = useSubmit(() => {
    if (isNew) {
      return editSchema(
        { type: 'add-column', table: ref, column: { ...form, defaultValue: toDbmlDefault(form.defaultValue) } },
        { quiet: true },
      )
    }
    // only send what changed, so untouched settings stay exactly as written
    const patch: ColumnPatch = {}
    if (form.name !== initial.name) patch.name = form.name
    if (form.type !== initial.type) patch.type = form.type
    if (form.pk !== initial.pk) patch.pk = form.pk
    if (form.unique !== initial.unique) patch.unique = form.unique
    if (form.notNull !== initial.notNull) patch.notNull = form.notNull
    if (form.defaultValue !== initial.defaultValue) patch.defaultValue = toDbmlDefault(form.defaultValue)
    if (!Object.keys(patch).length) return Promise.resolve({ ok: true })
    return editSchema({ type: 'update-column', table: ref, column: initial.name, patch }, { quiet: true })
  })

  const remove = async () => {
    if (!field) return
    const res = await editSchema({ type: 'delete-column', table: ref, column: field.name }, { done: `Deleted ${label(table)}.${field.name}`, undoable: true })
    if (res.ok) close()
  }

  const title = isNew ? `New column in ${label(table)}` : `${label(table)}.${field.name}`
  return (
    <Popover x={overlay.x} y={overlay.y} label={isNew ? title : `Edit column ${title}`} onClose={close} width={300}>
      <form onSubmit={submit} className="p-3">
        <div className="mb-2.5 truncate text-[12.5px] font-semibold" title={title}>
          {title}
        </div>
        <div className="grid gap-2.5">
          <Field label="Name" htmlFor={ids.name}>
            <input
              id={ids.name}
              value={form.name}
              placeholder="column_name"
              onChange={(e) => set('name', e.target.value)}
              className={inputClass}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="Type" htmlFor={ids.type}>
            <input
              id={ids.type}
              value={form.type}
              list={ids.types}
              placeholder="varchar(255)"
              onChange={(e) => set('type', e.target.value)}
              className={inputClass}
              autoComplete="off"
              spellCheck={false}
            />
            <datalist id={ids.types}>
              {[...COLUMN_TYPES, ...enums.map((e) => e.id)].map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </Field>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px]">
            <legend className="sr-only">Constraints</legend>
            <Check label="Primary key" checked={form.pk} onChange={(v) => set('pk', v)} />
            <Check label="Unique" checked={form.unique} onChange={(v) => set('unique', v)} />
            <Check label="Not null" checked={form.notNull} onChange={(v) => set('notNull', v)} />
          </fieldset>
          <Field label="Default" htmlFor={ids.dflt} hint="Text, a number, true or false, or a function such as now().">
            <input
              id={ids.dflt}
              value={form.defaultValue}
              placeholder="none"
              onChange={(e) => set('defaultValue', e.target.value)}
              className={inputClass}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        </div>
        <FormError error={error} />
        <div className="mt-3 flex items-center gap-2">
          {!isNew ? (
            <Button size="sm" onClick={() => void remove()} className="-ml-2 text-danger hover:text-danger">
              <Trash2 size={13} /> Delete
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button size="sm" onClick={close}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit" disabled={busy || !form.name.trim() || !form.type.trim()}>
            {busy ? <LoaderCircle size={13} className="animate-spin" /> : null}
            {isNew ? 'Add column' : 'Save column'}
          </Button>
        </div>
      </form>
    </Popover>
  )
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
      {label}
    </label>
  )
}

/* ---------- picking the kind of a new relationship ---------- */

const REL_OPTIONS: { op: RefOp; label: string; describe: (from: string, to: string) => string }[] = [
  { op: '>', label: 'Many to one', describe: (f, t) => `each row in ${f} points to one row in ${t}` },
  { op: '<', label: 'One to many', describe: (f, t) => `each row in ${f} can have many rows in ${t}` },
  { op: '-', label: 'One to one', describe: (f, t) => `each row in ${f} matches at most one row in ${t}` },
  { op: '<>', label: 'Many to many', describe: (f, t) => `rows in ${f} and ${t} link many to many` },
]

function NewRefMenu({ overlay }: { overlay: Of<'new-ref'> }) {
  const model = useUi((s) => s.model)
  const from = findTable(model, overlay.from.tableId)
  const to = findTable(model, overlay.to.tableId)
  if (!from || !to) return null
  const ordered = [...REL_OPTIONS].sort((a, b) => Number(b.op === overlay.suggested) - Number(a.op === overlay.suggested))
  const items: MenuEntry[] = [
    { heading: `${label(from)}.${overlay.from.column} → ${label(to)}.${overlay.to.column}` },
    ...ordered.map((o) => ({
      label: o.label,
      hint: o.op,
      onSelect: () =>
        void editSchema({
          type: 'add-ref',
          from: { table: toTableRef(from), column: overlay.from.column },
          to: { table: toTableRef(to), column: overlay.to.column },
          op: o.op,
        }),
    })),
  ]
  const suggested = REL_OPTIONS.find((o) => o.op === overlay.suggested)
  return (
    <ContextMenu x={overlay.x} y={overlay.y} items={items} label="Choose the kind of relationship" onClose={close} width={280}>
      {suggested ? <p className="px-2.5 pt-1 pb-1.5 text-[11.5px] leading-snug text-ink-3">Suggested: {suggested.describe(from.name, to.name)}.</p> : null}
    </ContextMenu>
  )
}
