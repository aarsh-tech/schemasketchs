import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from 'react-resizable-panels'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { DiagramCanvas } from './canvas/DiagramCanvas'
import { SchemaEditor } from './editor/SchemaEditor'
import { StatusBar } from './StatusBar'
import { IconButton, Segmented } from './ui/primitives'
import { cx } from '@/lib/cx'
import { useUi } from '@/store/ui'
import type { MobileView } from '@/store/ui'

const safeStorage = {
  getItem: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  setItem: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* storage unavailable */
    }
  },
}

const MOBILE_QUERY = '(max-width: 767px)'
function useIsMobile() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(MOBILE_QUERY)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  )
}

function EditorColumn({ onCollapse }: { onCollapse?: () => void }) {
  return (
    <div className="flex h-full min-w-0 flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line pr-1 pl-3">
        <span className="text-[12.5px] font-medium text-ink-2">Schema</span>
        <span className="rounded bg-hover px-1.5 font-mono text-[10.5px] leading-[18px] text-ink-3">DBML</span>
        <span className="flex-1" />
        {onCollapse ? (
          <IconButton label="Hide editor" onClick={onCollapse} className="h-7 w-7">
            <PanelLeftClose size={15} />
          </IconButton>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">
        <SchemaEditor />
      </div>
      <StatusBar />
    </div>
  )
}

export function Workspace() {
  const isMobile = useIsMobile()
  const mobileView = useUi((s) => s.mobileView)
  const setMobileView = useUi((s) => s.setMobileView)
  const editorPanel = usePanelRef()
  const [collapsed, setCollapsed] = useState(false)
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'schemasketch-workspace', storage: safeStorage })

  // double-clicking a table on a phone should show the editor
  const reveal = useUi((s) => s.revealRequest)
  useEffect(() => {
    if (!reveal) return
    if (isMobile) setMobileView('editor')
    else if (editorPanel.current?.isCollapsed()) editorPanel.current.expand()
  }, [reveal, isMobile, setMobileView, editorPanel])

  if (isMobile) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center justify-center border-b border-line bg-panel">
          <Segmented<MobileView>
            label="View"
            value={mobileView}
            onChange={setMobileView}
            options={[
              { value: 'editor', label: 'Schema' },
              { value: 'diagram', label: 'Diagram' },
            ]}
          />
        </div>
        <div className="relative min-h-0 flex-1">
          {/* both stay mounted so the canvas keeps its size and viewport; the active one sits on top */}
          <div className={cx('absolute inset-0 bg-panel', mobileView === 'editor' ? 'z-10' : 'pointer-events-none z-0')} inert={mobileView !== 'editor'}>
            <EditorColumn />
          </div>
          <div className={cx('absolute inset-0 bg-canvas', mobileView === 'diagram' ? 'z-10' : 'pointer-events-none z-0')} inert={mobileView !== 'diagram'}>
            <DiagramCanvas />
          </div>
        </div>
      </div>
    )
  }

  return (
    <Group
      orientation="horizontal"
      id="schemasketch-workspace"
      className="min-h-0 flex-1"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <Panel
        id="editor"
        panelRef={editorPanel}
        defaultSize="34"
        minSize={280}
        maxSize="65"
        collapsible
        collapsedSize={0}
        onResize={(size) => setCollapsed(size.asPercentage === 0)}
      >
        <EditorColumn onCollapse={() => editorPanel.current?.collapse()} />
      </Panel>
      <Separator className="group relative w-px bg-line outline-none data-[separator=active]:bg-accent data-[separator=hover]:bg-accent data-[separator=focus]:bg-accent">
        <span className="absolute inset-y-0 -left-1.5 -right-1.5" />
      </Separator>
      <Panel id="diagram" minSize={320}>
        <div className="relative h-full">
          <DiagramCanvas />
          {collapsed ? (
            <div className="absolute top-3 left-3 z-10">
              <IconButton
                label="Show editor"
                onClick={() => editorPanel.current?.expand()}
                className="border border-line bg-raised shadow-table"
              >
                <PanelLeftOpen size={15} />
              </IconButton>
            </div>
          ) : null}
        </div>
      </Panel>
    </Group>
  )
}
