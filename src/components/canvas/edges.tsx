import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from '@xyflow/react'
import type { EdgeProps } from '@xyflow/react'
import { memo, useState } from 'react'
import type { Cardinality } from '@/lib/dbml/types'
import type { RelationEdge } from './graph'

/* ----- crow's foot markers -----
   Drawn with the tip at x=20 (the table border) and the line arriving from the left. */
const SHAPES: Record<Cardinality, string> = {
  one: 'M0,10 L20,10 M12,4 L12,16 M16,4 L16,16',
  'zero-one': 'M0,10 L4.5,10 M11.5,10 L20,10 M15,4 L15,16',
  many: 'M0,10 L20,10 M9,10 L20,3 M9,10 L20,17',
  'zero-many': 'M0,10 L2.5,10 M9.5,10 L20,10 M10,10 L20,3 M10,10 L20,17',
}
const CIRCLE: Partial<Record<Cardinality, number>> = { 'zero-one': 8, 'zero-many': 6 }

const markerId = (c: Cardinality, active: boolean) => `schemasketch-${c}${active ? '-active' : ''}`

export function MarkerDefs() {
  const all: Cardinality[] = ['one', 'zero-one', 'many', 'zero-many']
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        {[false, true].flatMap((active) =>
          all.map((c) => {
            const stroke = active ? 'var(--c-edge-active)' : 'var(--c-edge)'
            return (
              <marker
                key={markerId(c, active)}
                id={markerId(c, active)}
                viewBox="0 0 20 20"
                refX="20"
                refY="10"
                markerWidth="20"
                markerHeight="20"
                markerUnits="userSpaceOnUse"
                orient="auto-start-reverse"
              >
                <path d={SHAPES[c]} fill="none" style={{ stroke, strokeWidth: 1.6, strokeLinecap: 'round' }} />
                {CIRCLE[c] != null ? (
                  <circle cx={CIRCLE[c]} cy="10" r="3.4" style={{ fill: 'var(--c-canvas)', stroke, strokeWidth: 1.6 }} />
                ) : null}
              </marker>
            )
          }),
        )}
      </defs>
    </svg>
  )
}

const WORD: Record<Cardinality, string> = { one: 'one', 'zero-one': 'zero or one', many: 'many', 'zero-many': 'zero or many' }

export const RelationEdgeView = memo(function RelationEdgeView(props: EdgeProps<RelationEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props
  const [hover, setHover] = useState(false)
  if (!data) return null
  const active = data.active || hover

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 10,
    offset: data.selfLoop ? 36 : 28,
  })

  const { ref } = data
  const s = `${ref.source.tableId}.${ref.source.fields.join(', ')}`
  const t = `${ref.target.tableId}.${ref.target.fields.join(', ')}`
  const actions = [ref.onDelete && `on delete ${ref.onDelete}`, ref.onUpdate && `on update ${ref.onUpdate}`].filter(Boolean)

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={0}
        markerStart={`url(#${markerId(data.sourceCardinality, active)})`}
        markerEnd={`url(#${markerId(data.targetCardinality, active)})`}
        style={{
          stroke: active ? 'var(--c-edge-active)' : 'var(--c-edge)',
          strokeWidth: active ? 1.9 : 1.5,
        }}
      />
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{ pointerEvents: 'stroke' }}
      />
      {hover ? (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute z-50 max-w-80 rounded-md border border-line bg-raised px-2.5 py-1.5 text-[12px] shadow-pop"
            style={{ transform: `translate(-50%, calc(-100% - 10px)) translate(${labelX}px, ${labelY}px)` }}
          >
            <div className="font-mono text-[11.5px] text-ink">
              {s} <span className="text-ink-3">→</span> {t}
            </div>
            <div className="mt-0.5 text-ink-2">
              {WORD[data.sourceCardinality]} to {WORD[data.targetCardinality]}
              {ref.name ? `, ${ref.name}` : ''}
              {actions.length ? ` · ${actions.join(', ')}` : ''}
            </div>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
})

