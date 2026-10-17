import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ParseDiagnostic, SchemaModel } from '@/lib/dbml/types'
import { EMPTY_SCHEMA } from '@/lib/dbml/types'

export type ThemePref = 'light' | 'dark' | 'system'
export type DetailLevel = 'all' | 'keys' | 'name'
export type MobileView = 'editor' | 'diagram'

/** Focus mode: one table and its neighbours up to `depth` relationships away. */
export interface FocusMode {
  tableId: string
  depth: 1 | 2 | 3
  /** hide the other tables instead of dimming them */
  hide: boolean
}

interface UiState {
  theme: ThemePref
  detail: DetailLevel
  showMinimap: boolean
  mobileView: MobileView

  /** last successful parse – kept on screen while the source has errors */
  model: SchemaModel
  diagnostics: ParseDiagnostic[]
  parsing: boolean
  /** project id the model belongs to */
  modelProjectId: string | null

  /** table under the editor cursor, highlighted on the canvas */
  cursorTableId: string | null
  hoveredTableId: string | null
  /** set when the canvas asks the editor to jump to a table's definition */
  revealRequest: { name: string; column?: string | null; nonce: number } | null
  /** bumped to ask the canvas to run auto-layout */
  layoutRequest: number
  /** bumped to ask the canvas to fit everything in view */
  fitRequest: number
  /** bumped when the source is replaced from outside the editor (import, open) */
  editorEpoch: number
  /** bumped when saved positions are replaced (restoring a version), so the canvas re-reads them */
  canvasEpoch: number
  /** set when something asks the canvas to centre on a table */
  centerRequest: { id: string; nonce: number } | null
  focus: FocusMode | null

  setTheme: (t: ThemePref) => void
  setDetail: (d: DetailLevel) => void
  toggleMinimap: () => void
  setMobileView: (v: MobileView) => void
  setParseResult: (projectId: string, model: SchemaModel | null, diagnostics: ParseDiagnostic[]) => void
  setParsing: (v: boolean) => void
  resetModel: () => void
  setCursorTable: (id: string | null) => void
  setHoveredTable: (id: string | null) => void
  revealTable: (name: string, column?: string | null) => void
  requestLayout: () => void
  requestFit: () => void
  bumpEditor: () => void
  bumpCanvas: () => void
  centerOn: (id: string) => void
  setFocus: (focus: FocusMode | null) => void
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      theme: 'system',
      detail: 'all',
      showMinimap: true,
      mobileView: 'diagram',

      model: EMPTY_SCHEMA,
      diagnostics: [],
      parsing: false,
      modelProjectId: null,

      cursorTableId: null,
      hoveredTableId: null,
      revealRequest: null,
      layoutRequest: 0,
      fitRequest: 0,
      editorEpoch: 0,
      canvasEpoch: 0,
      centerRequest: null,
      focus: null,

      setTheme: (theme) => set({ theme }),
      setDetail: (detail) => set({ detail }),
      toggleMinimap: () => set((s) => ({ showMinimap: !s.showMinimap })),
      setMobileView: (mobileView) => set({ mobileView }),
      setParseResult: (projectId, model, diagnostics) =>
        set((s) => ({
          // keep the last good diagram for this project while there are errors
          model: model ?? (s.modelProjectId === projectId ? s.model : EMPTY_SCHEMA),
          modelProjectId: projectId,
          diagnostics,
          parsing: false,
        })),
      setParsing: (parsing) => set({ parsing }),
      resetModel: () => set({ model: EMPTY_SCHEMA, diagnostics: [], modelProjectId: null, cursorTableId: null, focus: null }),
      setCursorTable: (cursorTableId) => set({ cursorTableId }),
      setHoveredTable: (hoveredTableId) => set({ hoveredTableId }),
      revealTable: (name, column = null) => set({ revealRequest: { name, column, nonce: Date.now() } }),
      requestLayout: () => set((s) => ({ layoutRequest: s.layoutRequest + 1 })),
      requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
      bumpEditor: () => set((s) => ({ editorEpoch: s.editorEpoch + 1 })),
      bumpCanvas: () => set((s) => ({ canvasEpoch: s.canvasEpoch + 1 })),
      centerOn: (id) => set({ centerRequest: { id, nonce: Date.now() } }),
      setFocus: (focus) => set({ focus }),
    }),
    {
      name: 'schemasketch:ui',
      partialize: (s) => ({ theme: s.theme, detail: s.detail, showMinimap: s.showMinimap }) as UiState,
    },
  ),
)
