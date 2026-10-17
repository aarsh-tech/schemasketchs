import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { Ellipsis, TriangleAlert } from 'lucide-react'
import { memo } from 'react'
import type { FieldModel } from '@/lib/dbml/types'
import { useProblems } from '@/hooks/useProblems'
import { useCanvas } from '@/store/canvas'
import { useCollab } from '@/store/collab'
import { useUi } from '@/store/ui'
import { cancelPendingClick, connectHandleId, dropHandleId, openColumn, openColumnSoon } from './editing'
import type { TableNode } from './graph'
import { ROW_CLASS, describeField } from './graph'
import { ROW_H } from './layout'
import { FieldCells, RowHandles, TableCard } from './parts'

export { GroupNodeView, NoteNodeView } from './parts'

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
      className={`${ROW_CLASS} cursor-pointer outline-none hover:bg-(--c-table-row-hover) focus-visible:bg-(--c-table-row-hover) focus-visible:shadow-[inset_2px_0_0_var(--c-accent)]`}
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
      <FieldCells field={field} />
    </div>
  )
}

/** Collaborators looking at this table, as "name|color" pairs so the selector stays a cheap string. */
function usePeersOn(tableId: string): { name: string; color: string }[] {
  const key = useCollab((s) => s.peers.filter((p) => p.table === tableId).map((p) => `${p.name}|${p.color}`).join('\n'))
  return key ? key.split('\n').map((k) => ({ name: k.split('|')[0], color: k.split('|')[1] })) : []
}

export const TableNodeView = memo(function TableNodeView({ data, selected }: NodeProps<TableNode>) {
  const { table, fields, hiddenCount, color, highlight } = data
  const peers = usePeersOn(table.id)
  return (
    <TableCard
      table={table}
      fields={fields}
      hiddenCount={hiddenCount}
      color={color}
      ring={selected || highlight === 'focus'}
      extraShadow={peers.length ? peers.map((p, i) => `0 0 0 ${2 + i * 2}px ${p.color}`).join(', ') : null}
      onMouseEnter={() => useUi.getState().setHoveredTable(table.id)}
      onMouseLeave={() => useUi.getState().setHoveredTable(null)}
      onDoubleClick={() => {
        cancelPendingClick()
        useCanvas.getState().close()
        useUi.getState().revealTable(table.id)
      }}
      above={
        peers.length ? (
          <div className="ss-export-hide pointer-events-none absolute -top-6 left-0 flex gap-1" aria-label={`Selected by ${peers.map((p) => p.name).join(', ')}`}>
            {peers.map((p) => (
              <span key={p.name} className="rounded-md px-1.5 py-0.5 text-[11px] leading-none font-semibold whitespace-nowrap text-white" style={{ background: p.color }}>
                {p.name}
              </span>
            ))}
          </div>
        ) : null
      }
      headerExtras={
        <>
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
        </>
      }
      renderRow={(f) => <FieldRow key={f.name} tableId={table.id} field={f} />}
    />
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
