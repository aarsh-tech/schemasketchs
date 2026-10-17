import { Background, BackgroundVariant, Panel, ReactFlow, ReactFlowProvider, ViewportPortal, applyNodeChanges, useNodesInitialized, useReactFlow } from '@xyflow/react'
import type { NodeChange } from '@xyflow/react'
import { ExternalLink, Maximize, Minus, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MarkerDefs, RelationEdgeView } from '@/components/canvas/edges'
import type { AnyNode, RelationEdge, TableNode } from '@/components/canvas/graph'
import { buildEdges, buildNodes, refreshGroups, relatedTables } from '@/components/canvas/graph'
import { autoLayout } from '@/components/canvas/layout'
import { GroupNodeView, NoteNodeView, ReadOnlyTableNode } from '@/components/canvas/parts'
import { IconButton } from '@/components/ui/primitives'
import { LogoMark } from '@/components/Logo'
import { parseDbml } from '@/lib/dbml/client'
import type { SchemaModel } from '@/lib/dbml/types'
import { readShareFromHash } from '@/lib/files'
import type { XY } from '@/lib/views'

const nodeTypes = { table: ReadOnlyTableNode, note: NoteNodeView, tableGroup: GroupNodeView }
const edgeTypes = { relation: RelationEdgeView }

type Loaded = { hash: string; model: SchemaModel | null; error: string | null }

export function EmbedApp() {
  const [hash, setHash] = useState(() => location.hash)
  useEffect(() => {
    const onHash = () => setHash(location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const file = useMemo(() => readShareFromHash(hash), [hash])
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    if (!file) return
    let cancelled = false
    parseDbml(file.source).then(
      ({ model, diagnostics }) => !cancelled && setLoaded({ hash, model, error: model ? null : (diagnostics[0]?.message ?? 'The schema has an error.') }),
      (err) => !cancelled && setLoaded({ hash, model: null, error: String(err) }),
    )
    return () => {
      cancelled = true
    }
  }, [file, hash])

  if (!file) {
    return <Message title="There's no diagram in this link">Copy the embed code again from Schemasketch: Share → Embed.</Message>
  }
  if (!loaded || loaded.hash !== hash) return <Message title="Drawing the diagram…" />
  if (!loaded.model) return <Message title="This diagram's schema has an error">{loaded.error} Fix it in Schemasketch and copy the embed code again.</Message>

  return (
    <ReactFlowProvider>
      <EmbedCanvas key={hash} model={loaded.model} positions={file.positions} name={file.name} openUrl={`${location.origin}/${hash}`} />
    </ReactFlowProvider>
  )
}

function Message({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-canvas p-6 text-center">
      <div className="max-w-sm">
        <h1 className="text-[15px] font-semibold">{title}</h1>
        {children ? <p className="mt-1 text-[13px] text-ink-2">{children}</p> : null}
      </div>
    </div>
  )
}

function withHighlight(n: TableNode, highlight: TableNode['data']['highlight'], className: string | undefined): TableNode {
  if (n.data.highlight === highlight && n.className === className) return n
  return { ...n, className, data: { ...n.data, highlight } }
}

function EmbedCanvas({ model, positions, name, openUrl }: { model: SchemaModel; positions: Record<string, XY>; name: string; openUrl: string }) {
  const rf = useReactFlow<AnyNode>()
  const nodesInitialized = useNodesInitialized()
  // no saved layout: lay the tables out once they've been measured
  const pendingLayout = useRef(!model.tables.some((t) => positions[t.id]))
  const fitted = useRef(false)
  const [nodes, setNodes] = useState<AnyNode[]>(() => {
    let i = 0
    return buildNodes(model, 'all', positions, new Map(), () => ({ x: (i % 6) * 300, y: Math.floor(i++ / 6) * 300 })).nodes
  })
  const [hovered, setHovered] = useState<string | null>(null)

  useEffect(() => {
    if (!nodesInitialized || fitted.current) return
    if (!rf.getNodes().every((n) => n.type === 'tableGroup' || n.measured?.height)) return
    fitted.current = true
    if (pendingLayout.current) {
      pendingLayout.current = false
      void autoLayout(model, rf.getNodes().filter((n) => n.type !== 'tableGroup')).then((laid) => {
        setNodes((prev) => refreshGroups(model, prev.map((n) => (laid[n.id] ? { ...n, position: laid[n.id] } : n))))
        requestAnimationFrame(() => rf.fitView({ padding: 0.08, maxZoom: 1.1 }))
      })
    } else {
      requestAnimationFrame(() => {
        setNodes((prev) => refreshGroups(model, prev))
        rf.fitView({ padding: 0.08, maxZoom: 1.1 })
      })
    }
  }, [nodesInitialized, nodes, model, rf])

  const onNodesChange = (changes: NodeChange<AnyNode>[]) =>
    setNodes((prev) => {
      const next = applyNodeChanges(changes, prev)
      return changes.some((c) => c.type === 'dimensions') ? refreshGroups(model, next) : next
    })

  // hovering a table lights up its relationships, as in the app
  const display = useMemo(() => {
    if (!hovered) return nodes
    const related = relatedTables(model, hovered)
    return nodes.map((n) => (n.type === 'table' ? withHighlight(n, n.id === hovered ? 'focus' : related.has(n.id) ? 'related' : null, related.has(n.id) ? undefined : 'is-dimmed') : n))
  }, [nodes, hovered, model])
  const edges = useMemo(() => buildEdges(model, nodes, hovered), [model, nodes, hovered])

  return (
    <div className="h-full w-full bg-canvas">
      <ReactFlow<AnyNode, RelationEdge>
        nodes={display}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeMouseEnter={(_e, n) => n.type === 'table' && setHovered(n.id)}
        onNodeMouseLeave={() => setHovered(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        // leave scrolling to the page the diagram is embedded in; zoom with the buttons, a pinch or Ctrl/⌘ + scroll
        zoomOnScroll={false}
        preventScrolling={false}
        zoomActivationKeyCode={['Meta', 'Control']}
        zoomOnPinch
        minZoom={0.1}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        className="schemasketch-flow"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--c-dot)" />
        <ViewportPortal>
          <MarkerDefs />
        </ViewportPortal>
        <Panel position="top-right" className="!m-2">
          <div className="flex items-center gap-0.5 rounded-lg border border-line bg-raised/95 p-0.5 shadow-table backdrop-blur">
            <IconButton label="Zoom out" onClick={() => rf.zoomOut({ duration: 150 })} className="h-7 w-7">
              <Minus size={14} />
            </IconButton>
            <IconButton label="Zoom in" onClick={() => rf.zoomIn({ duration: 150 })} className="h-7 w-7">
              <Plus size={14} />
            </IconButton>
            <IconButton label="Fit diagram" onClick={() => rf.fitView({ padding: 0.08, duration: 300, maxZoom: 1.1 })} className="h-7 w-7">
              <Maximize size={14} />
            </IconButton>
            <a
              href={openUrl}
              target="_blank"
              rel="noreferrer"
              title="Open a copy in Schemasketch"
              aria-label="Open a copy in Schemasketch"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
            >
              <ExternalLink size={14} />
            </a>
          </div>
        </Panel>
        <Panel position="bottom-left" className="!m-2">
          <a
            href={openUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-line bg-raised/95 px-2 py-1 text-[11.5px] text-ink-2 shadow-table backdrop-blur hover:text-ink"
          >
            <LogoMark size={14} />
            <span className="max-w-[40vw] truncate font-medium text-ink">{name}</span>
            <span className="text-ink-3">· Schemasketch</span>
          </a>
        </Panel>
      </ReactFlow>
    </div>
  )
}
