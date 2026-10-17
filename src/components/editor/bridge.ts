import { isolateHistory, undo } from '@codemirror/commands'
import { StateEffect, StateField, Transaction } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'

/*
 * Lets code outside the editor (canvas edits) change the DBML text through
 * CodeMirror, so each change shows up in the editor and Ctrl+Z undoes it.
 */

/** A one-shot line highlight, used when jumping to a table or after a canvas edit. */
export const flashEffect = StateEffect.define<number | null>()
export const flashField = StateField.define<DecorationSet>({
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

let current: EditorView | null = null
let flashTimer: ReturnType<typeof setTimeout> | undefined

export function attachEditor(view: EditorView) {
  current = view
}

const live = () => (current?.dom.isConnected ? current : null)

/** The editor's text, or null when no editor is mounted. */
export function editorText(): string | null {
  return live()?.state.doc.toString() ?? null
}

/**
 * Replace the editor's text with `next` as a single undoable change, but only
 * if it still holds `expected`. Only the part that differs is replaced, so the
 * cursor and scroll position elsewhere stay put.
 */
export function replaceEditorText(expected: string, next: string): boolean {
  const view = live()
  if (!view) return false
  const doc = view.state.doc.toString()
  if (doc !== expected) return false
  if (doc === next) return true

  let start = 0
  while (start < doc.length && start < next.length && doc[start] === next[start]) start++
  let endOld = doc.length
  let endNew = next.length
  while (endOld > start && endNew > start && doc[endOld - 1] === next[endNew - 1]) {
    endOld--
    endNew--
  }
  const line = view.state.doc.lineAt(start).from
  view.dispatch({
    changes: { from: start, to: endOld, insert: next.slice(start, endNew) },
    annotations: [Transaction.userEvent.of('input.canvas'), isolateHistory.of('full')],
    effects: [EditorView.scrollIntoView(start, { y: 'nearest', yMargin: 48 }), flashEffect.of(line)],
  })
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    if (view.dom.isConnected) view.dispatch({ effects: flashEffect.of(null) })
  }, 1300)
  return true
}

let undoOverride: (() => boolean) | null = null

/** In a live session, undo goes through the shared document so it only undoes your own changes. */
export function setUndoOverride(fn: (() => boolean) | null) {
  undoOverride = fn
}

/** Undo the last change in the editor (used by "Undo" in toasts). */
export function undoInEditor(): boolean {
  if (undoOverride) return undoOverride()
  const view = live()
  return view ? undo(view) : false
}
