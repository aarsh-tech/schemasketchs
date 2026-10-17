import { Panel, useReactFlow, useViewport } from '@xyflow/react'
import { Map as MapIcon, Maximize, Minus, Network, Plus } from 'lucide-react'
import { IconButton, Segmented } from '@/components/ui/primitives'
import { useUi } from '@/store/ui'
import type { DetailLevel } from '@/store/ui'

export function CanvasToolbar({ onLayout }: { onLayout: () => void }) {
  const rf = useReactFlow()
  const { zoom } = useViewport()
  const detail = useUi((s) => s.detail)
  const setDetail = useUi((s) => s.setDetail)
  const showMinimap = useUi((s) => s.showMinimap)
  const toggleMinimap = useUi((s) => s.toggleMinimap)

  return (
    <Panel position="bottom-left" className="!m-3 sm:!m-4">
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-line bg-raised/95 p-1 shadow-table backdrop-blur">
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
