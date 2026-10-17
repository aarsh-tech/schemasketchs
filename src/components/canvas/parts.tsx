import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { KeyRound, Link2 } from 'lucide-react'
import { memo } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'
import type { FieldModel, TableModel } from '@/lib/dbml/types'
import { readableText } from '@/lib/color'
import type { GroupNode, NoteNode, TableNode } from './graph'
import { ROW_CLASS, describeField, handleId } from './graph'
import { GROUP_LABEL_H, HEADER_H, ROW_H, TABLE_WIDTH } from './layout'

/* What a table, note and group look like, with no editing attached. Shared by
   the editor's canvas (nodes.tsx) and the read-only embed, which must not pull
   in the editor. */

/** Edges attach to these: one pair on each side of a row, or of the header. */
export function RowHandles({ field }: { field: string | null }) {
  return (
    <>
      <Handle type="source" position={Position.Left} id={handleId(field, 'l', 's')} isConnectable={false} />
      <Handle type="target" position={Position.Left} id={handleId(field, 'l', 't')} isConnectable={false} />
      <Handle type="source" position={Position.Right} id={handleId(field, 'r', 's')} isConnectable={false} />
      <Handle type="target" position={Position.Right} id={handleId(field, 'r', 't')} isConnectable={false} />
    </>
  )
}

/** Key icon, name, unique mark and type of one column. */
export function FieldCells({ field }: { field: FieldModel }) {
  return (
    <>
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
    </>
  )
}

/** A table card. The editor adds its menus, badges and clickable rows through the slots. */
export function TableCard({
  table,
  fields,
  hiddenCount,
  color,
  ring,
  extraShadow,
  above,
  headerExtras,
  renderRow,
  ...rest
}: {
  table: TableModel
  fields: FieldModel[]
  hiddenCount: number
  color: string
  ring: boolean
  /** outlines drawn outside the card, e.g. collaborators' colours */
  extraShadow?: string | null
  above?: ReactNode
  headerExtras?: ReactNode
  renderRow: (field: FieldModel) => ReactNode
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className="relative rounded-lg border bg-table shadow-table [&>:last-child]:overflow-hidden [&>:last-child]:rounded-b-[7px]"
      style={{
        width: TABLE_WIDTH,
        borderColor: ring ? color : 'var(--c-line-strong)',
        boxShadow: extraShadow ? `${extraShadow}, var(--shadow-table)` : ring ? `0 0 0 1.5px ${color}, var(--shadow-table)` : undefined,
      }}
      {...rest}
    >
      {above}
      <div className="relative flex items-center gap-2 overflow-hidden rounded-t-[7px] pr-1 pl-3" style={{ height: HEADER_H, background: color, color: readableText(color) }}>
        <RowHandles field={null} />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold tracking-[-0.01em]">
          {table.schema ? <span className="font-normal opacity-75">{table.schema}.</span> : null}
          {table.name}
        </span>
        {table.alias ? <span className="shrink-0 font-mono text-[11px] opacity-75">as {table.alias}</span> : null}
        {headerExtras}
      </div>
      {fields.map(renderRow)}
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
}

/** A table that can only be looked at (embeds). */
export const ReadOnlyTableNode = memo(function ReadOnlyTableNode({ data }: NodeProps<TableNode>) {
  const { table, fields, hiddenCount, color, highlight } = data
  return (
    <TableCard
      table={table}
      fields={fields}
      hiddenCount={hiddenCount}
      color={color}
      ring={highlight === 'focus'}
      renderRow={(f) => (
        <div key={f.name} className={ROW_CLASS} style={{ height: ROW_H }} title={describeField(f)}>
          <RowHandles field={f.name} />
          <FieldCells field={f} />
        </div>
      )}
    />
  )
})

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
