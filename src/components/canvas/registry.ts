import { RelationEdgeView } from './edges'
import { TableNodeView } from './nodes'
import { GroupNodeView, NoteNodeView } from './parts'

// defined once at module level so React Flow never sees new objects
export const nodeTypes = {
  table: TableNodeView,
  note: NoteNodeView,
  tableGroup: GroupNodeView,
}

export const edgeTypes = { relation: RelationEdgeView }
