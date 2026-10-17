import { Panel, useReactFlow, useViewport } from '@xyflow/react'
import { Grid2x2Plus, Map as MapIcon, Maximize, Minus, Network, Plus, Redo2, Undo2 } from 'lucide-react'
import { Button, IconButton, Segmented } from '@/components/ui/primitives'
import { useLayoutHistory } from '@/store/layoutHistory'
import { useUi } from '@/store/ui'
import type { DetailLevel } from '@/store/ui'
import { addTable } from './editing'

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

export function CanvasToolbar({ onLayout, onStep, historyKey }: { onLayout: () => void; onStep: (dir: 'undo' | 'redo') => void; historyKey: string }) {
  const canUndo = useLayoutHistory((s) => (s.stacks[historyKey]?.past.length ?? 0) > 0)
  const canRedo = useLayoutHistory((s) => (s.stacks[historyKey]?.future.length ?? 0) > 0)
  const rf = useReactFlow()
  const { zoom } = useViewport()
  const detail = useUi((s) => s.detail)
  const setDetail = useUi((s) => s.setDetail)
  const showMinimap = useUi((s) => s.showMinimap)
  const toggleMinimap = useUi((s) => s.toggleMinimap)

  return (
    <Panel position="bottom-left" className="!m-3 sm:!m-4">
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-line bg-raised/95 p-1 shadow-table backdrop-blur">
        <Button onClick={() => void addTable()} title="Add a table in the middle of the view" aria-label="Add table" className="px-2 text-ink">
          <Grid2x2Plus size={15} />
          <span className="max-sm:hidden">Add table</span>
        </Button>
        <div className="mx-1 h-5 w-px bg-line" />
        <IconButton label="Zoom out" onClick={() => rf.zoomOut({ duration: 150 })}>
          <Minus size={15} />
        </IconButton>
        <button
          type="button"
          onClick={() => rf.zoomTo(1, { duration: 200 })}
          title="Reset zoom to 100%"
          className="h-8 w-12 rounded-md font-mono text-[11.5px] text-ink-2 tabular-nums hover:bg-hover hover:text-ink"
        >
          {Math.round(zoom * 100)}%
        </button>
        <IconButton label="Zoom in" onClick={() => rf.zoomIn({ duration: 150 })}>
          <Plus size={15} />
        </IconButton>
        <IconButton label="Fit diagram to screen" onClick={() => rf.fitView({ padding: 0.12, duration: 300, maxZoom: 1.1 })}>
          <Maximize size={15} />
        </IconButton>
        <div className="mx-1 h-5 w-px bg-line" />
        <IconButton label="Arrange tables automatically" onClick={onLayout}>
          <Network size={15} />
        </IconButton>
        <IconButton label={`Undo table move (${mod}Z)`} disabled={!canUndo} onClick={() => onStep('undo')}>
          <Undo2 size={15} />
        </IconButton>
        <IconButton label={`Redo table move (${mod}⇧Z)`} disabled={!canRedo} onClick={() => onStep('redo')} className="max-sm:hidden">
          <Redo2 size={15} />
        </IconButton>
        <IconButton label={showMinimap ? 'Hide minimap' : 'Show minimap'} active={showMinimap} onClick={toggleMinimap} className="max-sm:hidden">
          <MapIcon size={15} />
        </IconButton>
        <div className="mx-1 h-5 w-px bg-line max-sm:hidden" />
        <Segmented<DetailLevel>
          label="Columns shown"
          value={detail}
          onChange={setDetail}
          options={[
            { value: 'all', label: 'All', title: 'Show every column' },
            { value: 'keys', label: 'Keys', title: 'Show only primary and foreign keys' },
            { value: 'name', label: 'Names', title: 'Show table names only' },
          ]}
        />
      </div>
    </Panel>
  )
}
