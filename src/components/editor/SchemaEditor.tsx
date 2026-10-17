import { autocompletion } from '@codemirror/autocomplete'
import { setDiagnostics, lintGutter } from '@codemirror/lint'
import { EditorView, Decoration } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import { StateEffect, StateField, EditorSelection } from '@codemirror/state'
import { indentUnit } from '@codemirror/language'
import CodeMirror from '@uiw/react-codemirror'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { useEffect, useMemo, useRef } from 'react'
import { useProjects } from '@/store/projects'
import { useUi } from '@/store/ui'
import { dbmlHighlight, dbmlLanguage } from './dbmlLanguage'
import { dbmlCompletions, findTableLine, tableAtPosition, toCmDiagnostics } from './dbmlTools'

/* A one-shot line highlight used when jumping to a table from the canvas. */
const flashEffect = StateEffect.define<number | null>()
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(flashEffect)) {
        deco = e.value == null ? Decoration.none : Decoration.set([Decoration.line({ class: 'cm-flash-line' }).range(e.value)])
      }
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

const baseTheme = EditorView.theme({
  '&': { color: 'var(--c-ink)' },
  '.cm-content': { padding: '12px 0 40vh', caretColor: 'var(--c-accent)' },
  '.cm-line': { padding: '0 16px 0 12px' },
  '.cm-gutterElement': { padding: '0 8px 0 12px !important' },
})

export function SchemaEditor() {
  const activeId = useProjects((s) => s.activeId)
  const epoch = useUi((s) => s.editorEpoch)
  // read the source once per project (or after an import); afterwards the editor owns the text
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initial = useMemo(() => useProjects.getState().projects[activeId]?.source ?? '', [activeId, epoch])
  const ref = useRef<ReactCodeMirrorRef>(null)
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const extensions = useMemo(
    () => [
      dbmlLanguage,
      dbmlHighlight,
      indentUnit.of('  '),
      lintGutter(),
      flashField,
      baseTheme,
      autocompletion({ override: [dbmlCompletions(() => useUi.getState().model)], icons: false }),
      EditorView.updateListener.of((u) => {
        if (!u.selectionSet && !u.docChanged) return
        clearTimeout(cursorTimer.current)
        cursorTimer.current = setTimeout(() => {
          const id = tableAtPosition(u.state.doc, u.state.selection.main.head)
          if (useUi.getState().cursorTableId !== id) useUi.getState().setCursorTable(id)
        }, 120)
      }),
      EditorView.domEventHandlers({
        blur: () => {
          useUi.getState().setCursorTable(null)
        },
      }),
    ],
    [],
  )

  // push parser diagnostics into the editor
  const diagnostics = useUi((s) => s.diagnostics)
  useEffect(() => {
    const view = ref.current?.view
    if (!view) return
    view.dispatch(setDiagnostics(view.state, toCmDiagnostics(view.state.doc, diagnostics)))
  }, [diagnostics])

  // jump to a table when the canvas asks for it
  const reveal = useUi((s) => s.revealRequest)
  useEffect(() => {
    const view = ref.current?.view
    if (!view || !reveal) return
    const range = findTableLine(view.state.doc, reveal.name)
    if (!range) return
    const lineStart = view.state.doc.lineAt(range.from).from
    view.dispatch({
      selection: EditorSelection.single(range.from, range.to),
      effects: [EditorView.scrollIntoView(range.from, { y: 'center' }), flashEffect.of(lineStart)],
    })
    view.focus()
    const t = setTimeout(() => view.dispatch({ effects: flashEffect.of(null) }), 1300)
    return () => clearTimeout(t)
  }, [reveal])

  useEffect(() => () => clearTimeout(cursorTimer.current), [])

  return (
    <CodeMirror
      key={`${activeId}:${epoch}`}
      ref={ref}
      value={initial}
      onChange={(value) => useProjects.getState().setSource(value)}
      extensions={extensions}
      theme="none"
      height="100%"
      className="h-full"
      aria-label="DBML schema editor"
      basicSetup={{
        foldGutter: false,
        highlightActiveLineGutter: true,
        autocompletion: false,
        searchKeymap: true,
        tabSize: 2,
      }}
    />
  )
}
