import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  MiniMap,
  ReactFlow,
  ViewportPortal,
  applyNodeChanges,
  useConnection,
  useNodesInitialized,
  useReactFlow,
} from '@xyflow/react'
import type { Connection, EdgeChange, IsValidConnection, NodeChange, NodeMouseHandler, OnBeforeDelete, OnConnectEnd, OnNodeDrag } from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { cx } from '@/lib/cx'
import { useCanvas } from '@/store/canvas'
import { useProjects } from '@/store/projects'
import type { XY } from '@/store/projects'
import type { SchemaModel } from '@/lib/dbml/types'
import { useUi } from '@/store/ui'
import { CanvasOverlays } from './CanvasOverlays'
import { CanvasToolbar } from './CanvasToolbar'
import { deleteRelationship, fieldOfHandle, findTable, isDropHandle } from './editing'
import { EmptyCanvas } from './EmptyCanvas'
import { MarkerDefs } from './edges'
import type { AnyNode, RelationEdge, TableNode } from './graph'
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
  const canvasEpoch = useUi((s) => s.canvasEpoch)

  const [nodes, setNodes] = useState<AnyNode[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // edge ids follow the order of refs in the code, so a selection only holds for the model it was made on
  const [edgeSelection, setEdgeSelection] = useState<{ id: string; model: SchemaModel } | null>(null)
  const selectedEdgeId = edgeSelection?.model === model ? edgeSelection.id : null
  const connecting = useConnection((c) => c.inProgress)
  const nodesInitialized = useNodesInitialized()
  const wrapper = useRef<HTMLDivElement>(null)

  /* per-project bookkeeping */
  const pendingAuto = useRef(false)
  const pendingFit = useRef(false)
  const builtFor = useRef<string | null>(null)

  /* ---- model → nodes ---- */
  useEffect(() => {
    if (modelProjectId !== activeId) return
    const buildKey = `${activeId}:${epoch}:${canvasEpoch}`
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
  }, [model, detail, activeId, modelProjectId, epoch, canvasEpoch])

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

  const edges = useMemo(() => {
    const built = buildEdges(model, nodes, focusId && model.tables.some((t) => t.id === focusId) ? focusId : null)
    return selectedEdgeId ? built.map((e) => (e.id === selectedEdgeId ? { ...e, selected: true, className: undefined } : e)) : built
  }, [model, nodes, focusId, selectedEdgeId])

  /* ---- editing on the canvas ---- */
  const onEdgesChange = useCallback((changes: EdgeChange<RelationEdge>[]) => {
    for (const c of changes) {
      if (c.type !== 'select') continue
      if (c.selected) setEdgeSelection({ id: c.id, model: useUi.getState().model })
      else setEdgeSelection((cur) => (cur?.id === c.id ? null : cur))
    }
  }, [])

  // Delete / Backspace on a selected relationship removes it from the code.
  // Returning false stops React Flow deleting anything itself: the diagram follows the code.
  const onBeforeDelete: OnBeforeDelete<AnyNode, RelationEdge> = useCallback(async ({ edges: gone }) => {
    for (const e of gone) if (e.data) await deleteRelationship(e.data.ref)
    return false
  }, [])

  const isValidConnection: IsValidConnection<RelationEdge> = useCallback(
    (c: Connection | RelationEdge) => isDropHandle(c.targetHandle) && !(c.source === c.target && fieldOfHandle(c.sourceHandle) === fieldOfHandle(c.targetHandle)),
    [],
  )

  const onConnectEnd: OnConnectEnd = useCallback((event, state) => {
    if (!state.isValid || !state.fromNode || !state.toNode || !state.fromHandle || !state.toHandle) return
    const from = { tableId: state.fromNode.id, column: fieldOfHandle(state.fromHandle.id) }
    const to = { tableId: state.toNode.id, column: fieldOfHandle(state.toHandle.id) }
    const m = useUi.getState().model
    const fromField = findTable(m, from.tableId)?.fields.find((f) => f.name === from.column)
    const toField = findTable(m, to.tableId)?.fields.find((f) => f.name === to.column)
    // dragging from a key to a plain column reads as "one to many"
    const fromKey = !!(fromField?.pk || fromField?.unique)
    const toKey = !!(toField?.pk || toField?.unique)
    const point = 'changedTouches' in event ? event.changedTouches[0] : event
    useCanvas.getState().open({ type: 'new-ref', from, to, x: point.clientX + 4, y: point.clientY + 4, suggested: fromKey && !toKey ? '<' : '>' })
  }, [])

  const onNodeContextMenu: NodeMouseHandler<AnyNode> = useCallback((e, node) => {
    if (node.type !== 'table') return
    e.preventDefault()
    // keyboard context-menu key reports 0,0: anchor to the node instead
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX || r.left + 12
    const y = e.clientY || r.top + 12
    useCanvas.getState().open({ type: 'table-menu', tableId: node.id, x, y })
  }, [])

  const onPaneContextMenu = useCallback(
    (e: MouseEvent | ReactMouseEvent) => {
      e.preventDefault()
      useCanvas.getState().open({ type: 'pane-menu', x: e.clientX, y: e.clientY, flow: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }) })
    },
    [rf],
  )

  const isEmpty = model.tables.length === 0 && model.notes.length === 0

  return (
    <div ref={wrapper} className={cx('relative h-full w-full', connecting && 'is-connecting')} data-testid="diagram">
      <ReactFlow<AnyNode, RelationEdge>
        nodes={displayNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onPaneClick={() => setSelectedId(null)}
        onMoveStart={(e) => {
          if (e) useCanvas.getState().close()
        }}
        onBeforeDelete={onBeforeDelete}
        isValidConnection={isValidConnection}
        onConnectEnd={onConnectEnd}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: 'var(--c-accent)', strokeWidth: 1.8 }}
        connectionRadius={24}
        nodesConnectable
        edgesFocusable
        elevateNodesOnSelect={false}
        minZoom={0.1}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={['Delete', 'Backspace']}
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
      <CanvasOverlays />
    </div>
  )
}

function withHighlight(n: TableNode, highlight: TableNode['data']['highlight'], className: string | undefined): TableNode {
  if (n.data.highlight === highlight && n.className === className) return n
  return { ...n, className, data: { ...n.data, highlight } }
}

