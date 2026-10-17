import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ViewportPortal,
  applyNodeChanges,
  useNodesInitialized,
  useReactFlow,
} from '@xyflow/react'
import type { NodeChange, NodeMouseHandler, OnNodeDrag } from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useProjects } from '@/store/projects'
import type { XY } from '@/store/projects'
import { useUi } from '@/store/ui'
import { CanvasToolbar } from './CanvasToolbar'
import { EmptyCanvas } from './EmptyCanvas'
import { MarkerDefs } from './edges'
import type { AnyNode, TableNode } from './graph'
import { buildEdges, buildNodes, refreshGroups, relatedTables } from './graph'
import { autoLayout, findFreeSpot } from './layout'
import { edgeTypes, nodeTypes } from './registry'

export function DiagramCanvas() {
  const rf = useReactFlow<AnyNode>()
  const activeId = useProjects((s) => s.activeId)
  const model = useUi((s) => s.model)
  const modelProjectId = useUi((s) => s.modelProjectId)
  const detail = useUi((s) => s.detail)
  const showMinimap = useUi((s) => s.showMinimap)
  const hovered = useUi((s) => s.hoveredTableId)
  const cursorTable = useUi((s) => s.cursorTableId)
  const layoutRequest = useUi((s) => s.layoutRequest)
  const fitRequest = useUi((s) => s.fitRequest)
  const epoch = useUi((s) => s.editorEpoch)

  const [nodes, setNodes] = useState<AnyNode[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const nodesInitialized = useNodesInitialized()
  const wrapper = useRef<HTMLDivElement>(null)

  /* per-project bookkeeping */
  const pendingAuto = useRef(false)
  const pendingFit = useRef(false)
  const builtFor = useRef<string | null>(null)

  /* ---- model → nodes ---- */
  useEffect(() => {
    if (modelProjectId !== activeId) return
    const buildKey = `${activeId}:${epoch}`
    const switched = builtFor.current !== buildKey
    builtFor.current = buildKey
    const positions = useProjects.getState().projects[activeId]?.positions ?? {}

    setNodes((prev) => {
      const existing = switched ? new Map<string, AnyNode>() : new Map(prev.map((n) => [n.id, n]))
      const anyKnown = model.tables.some((t) => positions[t.id] || existing.has(t.id))
      if (switched || !anyKnown) {
        pendingAuto.current = !anyKnown && model.tables.length > 0
        pendingFit.current = true
      }
      const center = viewportCenter()
      let i = 0
      const { nodes: next, placed } = buildNodes(model, detail, positions, existing, (_id, size, taken) =>
        // before an auto-layout, rough placement is fine; otherwise find room near the middle of the view
        pendingAuto.current ? { x: (i++ % 6) * 300, y: Math.floor(i / 6) * 300 } : findFreeSpot(center, size, taken),
      )
      if (!pendingAuto.current && Object.keys(placed).length) {
        queueMicrotask(() => useProjects.getState().setPositions(placed))
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, detail, activeId, modelProjectId, epoch])

  function viewportCenter(): XY {
    const el = wrapper.current
    if (!el) return { x: 0, y: 0 }
    const r = el.getBoundingClientRect()
    return rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
  }

  /* ---- auto layout ---- */
  const runLayout = useCallback(
    async (fit = true) => {
      const current = rf.getNodes().filter((n) => n.type !== 'tableGroup')
      if (!current.length) return
      const positions = await autoLayout(useUi.getState().model, current)
      setNodes((prev) =>
        refreshGroups(
          useUi.getState().model,
          prev.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n)),
        ),
      )
      useProjects.getState().setPositions(positions)
      if (fit) requestAnimationFrame(() => rf.fitView({ padding: 0.12, duration: 300, maxZoom: 1.1 }))
    },
    [rf],
  )

  useEffect(() => {
    if (!nodesInitialized) return
    if (pendingAuto.current) {
      pendingAuto.current = false
      pendingFit.current = false
      void runLayout(true)
    } else if (pendingFit.current) {
      pendingFit.current = false
      setNodes((prev) => refreshGroups(useUi.getState().model, prev))
      requestAnimationFrame(() => rf.fitView({ padding: 0.12, maxZoom: 1.1 }))
    }
  }, [nodesInitialized, nodes, runLayout, rf])

  useEffect(() => {
    if (layoutRequest) void runLayout(true)
  }, [layoutRequest, runLayout])

  useEffect(() => {
    if (fitRequest) rf.fitView({ padding: 0.12, duration: 300, maxZoom: 1.1 })
  }, [fitRequest, rf])

  /* ---- interaction ---- */
  const onNodesChange = useCallback((changes: NodeChange<AnyNode>[]) => {
    setNodes((prev) => {
      const next = applyNodeChanges(changes, prev)
      // groups follow their tables while dragging and once tables are measured
      const touchesTables = changes.some((c) => c.type === 'position' || c.type === 'dimensions')
      return touchesTables ? refreshGroups(useUi.getState().model, next) : next
    })
  }, [])

  const onNodeDragStop: OnNodeDrag<AnyNode> = useCallback((_e, _node, dragged) => {
    const update: Record<string, XY> = {}
    for (const n of dragged) {
      if (n.type === 'tableGroup') continue
      update[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) }
    }
    useProjects.getState().setPositions(update)
  }, [])

  const onNodeClick: NodeMouseHandler<AnyNode> = useCallback((_e, node) => {
    if (node.type === 'table') setSelectedId(node.id)
  }, [])

  /* ---- highlight / dim ---- */
  const focusId = hovered ?? selectedId ?? cursorTable
  const displayNodes = useMemo(() => {
    if (!focusId || !model.tables.some((t) => t.id === focusId)) {
      return nodes.map((n) => (n.type === 'table' && (n.data.highlight || n.className) ? withHighlight(n, null, undefined) : n))
    }
    const related = relatedTables(model, focusId)
    return nodes.map((n) => {
      if (n.type !== 'table') return n
      const hl = n.id === focusId ? 'focus' : related.has(n.id) ? 'related' : null
      return withHighlight(n, hl, hl ? undefined : 'is-dimmed')
    })
  }, [nodes, focusId, model])

  const edges = useMemo(
    () => buildEdges(model, nodes, focusId && model.tables.some((t) => t.id === focusId) ? focusId : null),
    [model, nodes, focusId],
  )

  const isEmpty = model.tables.length === 0 && model.notes.length === 0

  return (
    <div ref={wrapper} className="relative h-full w-full" data-testid="diagram">
      <ReactFlow<AnyNode>
        nodes={displayNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onPaneClick={() => setSelectedId(null)}
        nodesConnectable={false}
        edgesFocusable={false}
        elevateNodesOnSelect={false}
        minZoom={0.1}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={null}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Meta', 'Control']}
        panOnScroll
        zoomOnPinch
        zoomActivationKeyCode={['Meta', 'Control']}
        fitView
        className="schemasketch-flow"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--c-dot)" />
        <ViewportPortal>
          <MarkerDefs />
        </ViewportPortal>
        {showMinimap && !isEmpty ? (
          <MiniMap<AnyNode>
            pannable
            zoomable
            position="bottom-right"
            nodeColor={(n) => (n.type === 'table' ? (n as TableNode).data.color : n.type === 'note' ? 'var(--c-key)' : 'transparent')}
            nodeStrokeWidth={0}
            nodeBorderRadius={4}
            className="!hidden sm:!block"
            style={{ width: 168, height: 112 }}
          />
        ) : null}
        <CanvasToolbar onLayout={() => void runLayout(true)} />
      </ReactFlow>
      {isEmpty ? <EmptyCanvas /> : null}
    </div>
  )
}

function withHighlight(n: TableNode, highlight: TableNode['data']['highlight'], className: string | undefined): TableNode {
  if (n.data.highlight === highlight && n.className === className) return n
  return { ...n, className, data: { ...n.data, highlight } }
}

