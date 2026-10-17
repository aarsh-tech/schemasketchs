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
import { activeViewOf, positionsOf, useProjects } from '@/store/projects'
import type { XY } from '@/store/projects'
import type { SchemaModel } from '@/lib/dbml/types'
import { makeStep } from '@/lib/layoutHistory'
import { tablesWithin } from '@/lib/search'
import { useLayoutHistory } from '@/store/layoutHistory'
import { onRemoteMoves, shareSelectedTable } from '@/store/collab'
import { viewModel } from '@/lib/views'
import { useUi } from '@/store/ui'
import { CanvasOverlays } from './CanvasOverlays'
import { CanvasToolbar } from './CanvasToolbar'
import { deleteRelationship, fieldOfHandle, findTable, isDropHandle } from './editing'
import { EmptyCanvas, EmptyView } from './EmptyCanvas'
import { FocusBar } from './FocusBar'
import { MarkerDefs } from './edges'
import type { AnyNode, RelationEdge, TableNode } from './graph'
import { buildEdges, buildNodes, refreshGroups, relatedTables } from './graph'
import { autoLayout, findFreeSpot } from './layout'
import { edgeTypes, nodeTypes } from './registry'

export function DiagramCanvas() {
  const rf = useReactFlow<AnyNode>()
  const activeId = useProjects((s) => s.activeId)
  const fullModel = useUi((s) => s.model)
  const view = useProjects((s) => activeViewOf(s.projects[s.activeId]))
  const viewTables = view?.tableIds
  // a view shows only its tables; everything below works on this model
  const model = useMemo(() => (viewTables ? viewModel(fullModel, viewTables) : fullModel), [fullModel, viewTables])
  const modelRef = useRef(model)
  useEffect(() => {
    modelRef.current = model
  })
  const modelProjectId = useUi((s) => s.modelProjectId)
  const detail = useUi((s) => s.detail)
  const showMinimap = useUi((s) => s.showMinimap)
  const hovered = useUi((s) => s.hoveredTableId)
  const cursorTable = useUi((s) => s.cursorTableId)
  const layoutRequest = useUi((s) => s.layoutRequest)
  const fitRequest = useUi((s) => s.fitRequest)
  const epoch = useUi((s) => s.editorEpoch)
  const canvasEpoch = useUi((s) => s.canvasEpoch)
  const centerRequest = useUi((s) => s.centerRequest)
  const focus = useUi((s) => s.focus)

  const [nodes, setNodes] = useState<AnyNode[]>([])
  useEffect(() => {
    nodesRef.current = nodes
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // edge ids follow the order of refs in the code, so a selection only holds for the model it was made on
  const [edgeSelection, setEdgeSelection] = useState<{ id: string; model: SchemaModel } | null>(null)
  const selectedEdgeId = edgeSelection?.model === model ? edgeSelection.id : null
  const connecting = useConnection((c) => c.inProgress)
  const nodesInitialized = useNodesInitialized()
  const wrapper = useRef<HTMLDivElement>(null)

  /* per-project bookkeeping */
  const pendingCenter = useRef<string | null>(null)
  const nodesRef = useRef<AnyNode[]>([])
  const pendingAuto = useRef(false)
  const pendingFit = useRef(false)
  const builtFor = useRef<string | null>(null)

  /* ---- model → nodes ---- */
  useEffect(() => {
    if (modelProjectId !== activeId) return
    const buildKey = `${activeId}:${epoch}:${canvasEpoch}:${view?.id ?? ''}`
    const switched = builtFor.current !== buildKey
    builtFor.current = buildKey
    const positions = positionsOf(useProjects.getState().projects[activeId])

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
  }, [model, detail, activeId, modelProjectId, epoch, canvasEpoch, view?.id])

  function viewportCenter(): XY {
    const el = wrapper.current
    if (!el) return { x: 0, y: 0 }
    const r = el.getBoundingClientRect()
    return rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
  }

  /* ---- auto layout ---- */
  /** Move nodes to `positions`, on screen and in the saved layout. */
  const applyLayout = useCallback((positions: Record<string, XY>) => {
    setNodes((prev) =>
      refreshGroups(
        modelRef.current,
        prev.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n)),
      ),
    )
    useProjects.getState().setPositions(positions)
  }, [])

  /** Undo stacks are kept per project and per view. */
  const historyKey = `${activeId}:${view?.id ?? ''}`
  const historyKeyRef = useRef(historyKey)
  useEffect(() => {
    historyKeyRef.current = historyKey
  })
  const remember = useCallback((before: Record<string, XY>, after: Record<string, XY>) => {
    const step = makeStep(before, after)
    if (step) useLayoutHistory.getState().record(historyKeyRef.current, step)
  }, [])
  const stepLayout = useCallback(
    (dir: 'undo' | 'redo') => {
      const positions = useLayoutHistory.getState().take(historyKeyRef.current, dir)
      if (positions) applyLayout(positions)
    },
    [applyLayout],
  )

  const runLayout = useCallback(
    async (fit = true, undoable = false) => {
      const current = rf.getNodes().filter((n) => n.type !== 'tableGroup')
      if (!current.length) return
      const before = Object.fromEntries(current.map((n) => [n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }]))
      const positions = await autoLayout(modelRef.current, current)
      applyLayout(positions)
      // the first automatic layout of a new schema isn't something to undo back from
      if (undoable) remember(before, positions)
      if (fit) requestAnimationFrame(() => rf.fitView({ padding: 0.12, duration: 300, maxZoom: 1.1 }))
    },
    [rf, applyLayout, remember],
  )

  // Ctrl/⌘+Z and Ctrl/⌘+Shift+Z (or Ctrl+Y) move tables back and forth, unless the editor or a form has focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const key = e.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      const t = e.target as HTMLElement | null
      if (t?.closest('.cm-editor, input, textarea, select, [contenteditable="true"], dialog') || document.querySelector('dialog[open]')) return
      if (!wrapper.current?.isConnected || wrapper.current.closest('[inert]')) return
      e.preventDefault()
      stepLayout(key === 'y' || e.shiftKey ? 'redo' : 'undo')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stepLayout])

  const centerOnNode = useCallback(
    (id: string) => {
      requestAnimationFrame(() => {
        rf.fitView({ nodes: [{ id }], padding: 0.5, duration: 350, maxZoom: 1.1 })
        setSelectedId(id)
      })
    },
    [rf],
  )

  useEffect(() => {
    if (!nodesInitialized) return
    // right after the nodes are swapped (switching view or project), the flag still describes the old ones
    if (!rf.getNodes().every((n) => n.type === 'tableGroup' || n.measured?.height)) return
    if (pendingAuto.current) {
      pendingAuto.current = false
      pendingFit.current = false
      void runLayout(true)
    } else if (pendingFit.current) {
      pendingFit.current = false
      setNodes((prev) => refreshGroups(modelRef.current, prev))
      const center = pendingCenter.current
      pendingCenter.current = null
      if (center && rf.getNode(center)) centerOnNode(center)
      else requestAnimationFrame(() => rf.fitView({ padding: 0.12, maxZoom: 1.1 }))
    }
  }, [nodesInitialized, nodes, runLayout, rf, centerOnNode])

  useEffect(() => {
    if (layoutRequest) void runLayout(true, true)
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
      return touchesTables ? refreshGroups(modelRef.current, next) : next
    })
  }, [])

  const dragFrom = useRef<Record<string, XY>>({})
  const onNodeDragStart: OnNodeDrag<AnyNode> = useCallback((_e, _node, dragged) => {
    dragFrom.current = Object.fromEntries(dragged.map((n) => [n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }]))
  }, [])

  const onNodeDragStop: OnNodeDrag<AnyNode> = useCallback(
    (_e, _node, dragged) => {
      const update: Record<string, XY> = {}
      for (const n of dragged) {
        if (n.type === 'tableGroup') continue
        update[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) }
      }
      useProjects.getState().setPositions(update)
      remember(dragFrom.current, update)
    },
    [remember],
  )

  const onNodeClick: NodeMouseHandler<AnyNode> = useCallback((_e, node) => {
    if (node.type === 'table') setSelectedId(node.id)
  }, [])

  /* ---- focus mode: one table and its neighbourhood ---- */
  const focusMode = focus && model.tables.some((t) => t.id === focus.tableId) ? focus : null
  const focusSet = useMemo(() => (focusMode ? tablesWithin(model, focusMode.tableId, focusMode.depth) : null), [model, focusMode])
  const focusSetRef = useRef(focusSet)
  useEffect(() => {
    focusSetRef.current = focusSet
  })

  /* ---- highlight / dim ---- */
  const focusId = focusMode ? focusMode.tableId : (hovered ?? selectedId ?? cursorTable)
  const displayNodes = useMemo(() => {
    if (focusSet) {
      const shown = focusMode!.hide ? nodes.filter((n) => n.type === 'table' && focusSet.has(n.id)) : nodes
      return shown.map((n) => {
        if (n.type !== 'table') return n
        const d = focusSet.get(n.id)
        return withHighlight(n, d === 0 ? 'focus' : d === 1 ? 'related' : null, d === undefined ? 'is-dimmed' : undefined)
      })
    }
    if (!focusId || !model.tables.some((t) => t.id === focusId)) {
      return nodes.map((n) => (n.type === 'table' && (n.data.highlight || n.className) ? withHighlight(n, null, undefined) : n))
    }
    const related = relatedTables(model, focusId)
    return nodes.map((n) => {
      if (n.type !== 'table') return n
      const hl = n.id === focusId ? 'focus' : related.has(n.id) ? 'related' : null
      return withHighlight(n, hl, hl ? undefined : 'is-dimmed')
    })
  }, [nodes, focusId, focusSet, focusMode, model])

  const edges = useMemo(() => {
    let built = buildEdges(model, displayNodes, focusId && model.tables.some((t) => t.id === focusId) ? focusId : null)
    // in focus mode an edge stays lit when both ends are in the neighbourhood
    if (focusSet) built = built.map((e) => (focusSet.has(e.source) && focusSet.has(e.target) ? { ...e, className: undefined } : { ...e, className: 'is-dimmed' }))
    return selectedEdgeId ? built.map((e) => (e.id === selectedEdgeId ? { ...e, selected: true, className: undefined } : e)) : built
  }, [model, displayNodes, focusId, focusSet, selectedEdgeId])

  // frame the neighbourhood whenever focus mode starts or changes
  const focusKey = focusMode ? `${focusMode.tableId}:${focusMode.depth}:${focusMode.hide}` : ''
  useEffect(() => {
    if (!focusKey) return
    const ids = [...(focusSetRef.current?.keys() ?? [])].map((id) => ({ id }))
    const raf = requestAnimationFrame(() => rf.fitView({ nodes: ids, padding: 0.18, duration: 300, maxZoom: 1.1 }))
    return () => cancelAnimationFrame(raf)
  }, [focusKey, rf])

  /* ---- live session: others' moves, and the table we're on ---- */
  useEffect(
    () =>
      onRemoteMoves((projectId, positions) => {
        if (projectId !== activeId || view) return
        setNodes((prev) => refreshGroups(modelRef.current, prev.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n))))
      }),
    [activeId, view],
  )
  useEffect(() => {
    shareSelectedTable(selectedId ?? cursorTable)
  }, [selectedId, cursorTable])

  /* ---- centre on a table (command palette) ---- */
  useEffect(() => {
    if (!centerRequest) return
    const id = centerRequest.id
    const store = useProjects.getState()
    const hiddenByFocus = !!focusSetRef.current && useUi.getState().focus?.hide && !focusSetRef.current.has(id)
    if (hiddenByFocus) useUi.getState().setFocus(null)
    if (nodesRef.current.some((n) => n.id === id)) {
      centerOnNode(id)
      return
    }
    // the table isn't in the open view: show the full diagram, then centre on it
    if (activeViewOf(store.projects[store.activeId]) && useUi.getState().model.tables.some((t) => t.id === id)) {
      pendingCenter.current = id
      store.setActiveView(null)
    }
  }, [centerRequest, centerOnNode])

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
  const emptyView = !!view && model.tables.length === 0 && fullModel.tables.length > 0

  return (
    <div ref={wrapper} className={cx('relative h-full w-full', connecting && 'is-connecting')} data-testid="diagram">
      <ReactFlow<AnyNode, RelationEdge>
        nodes={displayNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={onNodeDragStart}
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
        <CanvasToolbar onLayout={() => void runLayout(true, true)} onStep={stepLayout} historyKey={historyKey} />
        {focusMode && focusSet ? <FocusBar focus={focusMode} shown={focusSet.size} /> : null}
      </ReactFlow>
      {emptyView ? <EmptyView viewId={view.id} /> : isEmpty ? <EmptyCanvas /> : null}
      <CanvasOverlays />
    </div>
  )
}

function withHighlight(n: TableNode, highlight: TableNode['data']['highlight'], className: string | undefined): TableNode {
  if (n.data.highlight === highlight && n.className === className) return n
  return { ...n, className, data: { ...n.data, highlight } }
}

