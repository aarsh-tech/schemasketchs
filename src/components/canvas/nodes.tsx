import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { Ellipsis, KeyRound, Link2, TriangleAlert } from 'lucide-react'
import { memo } from 'react'
import type { FieldModel } from '@/lib/dbml/types'
import { useProblems } from '@/hooks/useProblems'
import { readableText } from '@/lib/color'
import { useCanvas } from '@/store/canvas'
import { useUi } from '@/store/ui'
import { cancelPendingClick, connectHandleId, dropHandleId, openColumn, openColumnSoon } from './editing'
import type { GroupNode, NoteNode, TableNode } from './graph'
import { handleId } from './graph'
import { GROUP_LABEL_H, HEADER_H, ROW_H, TABLE_WIDTH } from './layout'

function RowHandles({ field }: { field: string | null }) {
  return (
    <>
      <Handle type="source" position={Position.Left} id={handleId(field, 'l', 's')} isConnectable={false} />
      <Handle type="target" position={Position.Left} id={handleId(field, 'l', 't')} isConnectable={false} />
      <Handle type="source" position={Position.Right} id={handleId(field, 'r', 's')} isConnectable={false} />
      <Handle type="target" position={Position.Right} id={handleId(field, 'r', 't')} isConnectable={false} />
    </>
  )
}

function describeField(f: FieldModel): string {
  const bits = [`${f.name}  ${f.type}`]
  const flags = [
    f.pk && 'primary key',
    f.increment && 'auto increment',
    f.unique && 'unique',
    f.notNull && 'not null',
    f.defaultValue && `default ${f.defaultValue}`,
  ].filter(Boolean)
  if (flags.length) bits.push(flags.join(', '))
  if (f.note) bits.push(f.note)
  return bits.join('\n')
}

/** Drag from a dot to another column to relate them; the whole row accepts the drop. */
function ConnectHandles({ field }: { field: string }) {
  return (
    <>
      <Handle type="target" position={Position.Left} id={dropHandleId(field)} className="ss-drop" isConnectableStart={false} />
      <Handle type="source" position={Position.Left} id={connectHandleId(field, 'l')} className="ss-connect" isConnectableEnd={false} title="Drag to another column to relate them" />
      <Handle type="source" position={Position.Right} id={connectHandleId(field, 'r')} className="ss-connect" isConnectableEnd={false} title="Drag to another column to relate them" />
    </>
  )
}

function FieldRow({ tableId, field }: { tableId: string; field: FieldModel }) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Edit column ${field.name}`}
      className="ss-row relative flex cursor-pointer items-center gap-2 border-t border-line/70 px-3 text-[12.5px] outline-none hover:bg-(--c-table-row-hover) focus-visible:bg-(--c-table-row-hover) focus-visible:shadow-[inset_2px_0_0_var(--c-accent)]"
      style={{ height: ROW_H }}
      title={describeField(field)}
      onClick={(e) => openColumnSoon(tableId, field.name, e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        e.stopPropagation()
        openColumn(tableId, field.name, e.currentTarget)
      }}
    >
      <RowHandles field={field.name} />
      <ConnectHandles field={field.name} />
      <span className="flex w-3.5 shrink-0 justify-center" aria-hidden>
        {field.pk ? (
          <KeyRound size={13} strokeWidth={2.4} className="text-key" />
        ) : field.isRef ? (
          <Link2 size={13} strokeWidth={2.4} className="text-ref" />
        ) : null}
      </span>
      <span className={`min-w-0 flex-1 truncate ${field.pk ? 'font-semibold' : ''}`}>
        {field.name}
        {field.notNull && !field.pk ? <span className="ml-0.5 text-ink-3" title="not null">*</span> : null}
      </span>
      {field.unique && !field.pk ? (
        <span className="rounded-sm border border-line-strong px-1 font-mono text-[9.5px] leading-[14px] text-ink-2" title="unique">
          U
        </span>
      ) : null}
      <span className={`shrink-0 truncate font-mono text-[11.5px] ${field.enumName ? 'text-key' : 'text-ink-3'}`} style={{ maxWidth: 130 }}>
        {field.type}
      </span>
    </div>
  )
}

export const TableNodeView = memo(function TableNodeView({ data, selected }: NodeProps<TableNode>) {
  const { table, fields, hiddenCount, color, highlight } = data
  const ring = selected || highlight === 'focus'
  return (
    <div
      className="overflow-hidden rounded-lg border bg-table shadow-table"
      style={{
        width: TABLE_WIDTH,
        borderColor: ring ? color : 'var(--c-line-strong)',
        boxShadow: ring ? `0 0 0 1.5px ${color}, var(--shadow-table)` : undefined,
      }}
      onMouseEnter={() => useUi.getState().setHoveredTable(table.id)}
      onMouseLeave={() => useUi.getState().setHoveredTable(null)}
      onDoubleClick={() => {
        cancelPendingClick()
        useCanvas.getState().close()
        useUi.getState().revealTable(table.id)
      }}
    >
      <div className="relative flex items-center gap-2 pr-1 pl-3" style={{ height: HEADER_H, background: color, color: readableText(color) }}>
        <RowHandles field={null} />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold tracking-[-0.01em]">
          {table.schema ? <span className="font-normal opacity-75">{table.schema}.</span> : null}
          {table.name}
        </span>
        {table.alias ? <span className="shrink-0 font-mono text-[11px] opacity-75">as {table.alias}</span> : null}
        <ProblemBadge tableId={table.id} />
        <button
          type="button"
          aria-label={`Actions for ${table.name}`}
          title="Table actions"
          className="ss-table-menu nodrag inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-current/15 focus-visible:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            const r = e.currentTarget.getBoundingClientRect()
            useCanvas.getState().open({ type: 'table-menu', tableId: table.id, x: r.left, y: r.bottom + 4 })
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Ellipsis size={15} />
        </button>
      </div>
      {fields.map((f) => (
        <FieldRow key={f.name} tableId={table.id} field={f} />
      ))}
      {hiddenCount > 0 && fields.length > 0 ? (
        <div className="border-t border-line/70 px-3 py-1 text-[11px] text-ink-3">
          {hiddenCount} more {hiddenCount === 1 ? 'column' : 'columns'}
        </div>
      ) : null}
      {table.note && fields.length > 0 ? (
        <div className="border-t border-line/70 px-3 py-1.5 text-[11.5px] leading-snug text-ink-2" title={table.note}>
          <span className="line-clamp-2">{table.note}</span>
        </div>
      ) : null}
    </div>
  )
})

/** Lint findings for one table; opens the first one in the editor. */
function ProblemBadge({ tableId }: { tableId: string }) {
  const problems = useProblems().byTable.get(tableId)
  if (!problems?.length) return null
  const summary = problems.map((p) => `• ${p.message}`).join('\n')
  return (
    <button
      type="button"
      title={summary}
      aria-label={`${problems.length} ${problems.length === 1 ? 'problem' : 'problems'} found by the schema checks. Show in the code`}
      className="ss-export-hide nodrag inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full border border-warn/40 bg-warn-soft px-1.5 font-mono text-[10.5px] font-semibold text-warn"
      onClick={(e) => {
        e.stopPropagation()
        useUi.getState().revealTable(tableId, problems[0].column)
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <TriangleAlert size={11} strokeWidth={2.4} />
      {problems.length}
    </button>
  )
}

export const NoteNodeView = memo(function NoteNodeView({ data, selected }: NodeProps<NoteNode>) {
  const { note } = data
  return (
    <div
      className="rounded-md px-3.5 pt-2.5 pb-3 text-note-ink shadow-table"
      style={{
        background: 'var(--c-note)',
        borderTop: `3px solid ${note.color ?? 'var(--c-key)'}`,
        outline: selected ? '1.5px solid var(--c-key)' : undefined,
      }}
    >
      <div className="mb-1 text-[11.5px] font-semibold opacity-70">{note.name.replace(/_/g, ' ')}</div>
      <div className="text-[12.5px] leading-relaxed whitespace-pre-wrap">{note.content.trim()}</div>
    </div>
  )
})

export const GroupNodeView = memo(function GroupNodeView({ data, width, height }: NodeProps<GroupNode>) {
  const { group, color } = data
  return (
    <div
      className="rounded-xl border"
      style={{
        width,
        height,
        borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
        background: `color-mix(in srgb, ${color} 7%, transparent)`,
      }}
      title={group.note ?? undefined}
    >
      <div className="flex items-center px-4 text-[13px] font-semibold" style={{ height: GROUP_LABEL_H + 6, color }}>
        {group.name.replace(/_/g, ' ')}
      </div>
    </div>
  )
})

