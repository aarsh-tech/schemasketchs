import { create } from 'zustand'
import type { RefOp } from '@/lib/dbml/edit'

/** A column on the canvas: table node id + column name. */
export interface ColumnAt {
  tableId: string
  column: string
}

/** Floating editors shown over the canvas. x/y are viewport coordinates. */
export type CanvasOverlay =
  | { type: 'table-menu'; tableId: string; x: number; y: number }
  | { type: 'pane-menu'; x: number; y: number; flow: { x: number; y: number } }
  | { type: 'rename-table'; tableId: string; x: number; y: number }
  /** column null: adding a new column */
  | { type: 'column'; tableId: string; column: string | null; x: number; y: number }
  | { type: 'new-ref'; from: ColumnAt; to: ColumnAt; x: number; y: number; suggested: RefOp }

interface CanvasState {
  overlay: CanvasOverlay | null
  open: (o: CanvasOverlay) => void
  close: () => void
}

export const useCanvas = create<CanvasState>((set) => ({
  overlay: null,
  open: (overlay) => set({ overlay }),
  close: () => set({ overlay: null }),
}))
