import type { XY } from '@/lib/views'

/* Undo and redo for table moves on the canvas. The DBML has its own undo in
   the editor; this only covers positions, which live outside the text. Pure. */

export interface LayoutStep {
  /** positions of the moved nodes before and after */
  before: Record<string, XY>
  after: Record<string, XY>
}

export interface LayoutStack {
  past: LayoutStep[]
  future: LayoutStep[]
}

export const EMPTY_STACK: LayoutStack = { past: [], future: [] }
export const MAX_STEPS = 100

const same = (a: XY | undefined, b: XY | undefined) => !!a && !!b && a.x === b.x && a.y === b.y

/** Keep only nodes that actually moved; null when none did. */
export function makeStep(before: Record<string, XY>, after: Record<string, XY>): LayoutStep | null {
  const b: Record<string, XY> = {}
  const a: Record<string, XY> = {}
  for (const [id, to] of Object.entries(after)) {
    const from = before[id]
    if (!from || same(from, to)) continue
    b[id] = from
    a[id] = to
  }
  return Object.keys(a).length ? { before: b, after: a } : null
}

/** A new step clears what could be redone. */
export function record(stack: LayoutStack, step: LayoutStep): LayoutStack {
  return { past: [...stack.past, step].slice(-MAX_STEPS), future: [] }
}

export function undo(stack: LayoutStack): { stack: LayoutStack; apply: Record<string, XY> } | null {
  const step = stack.past[stack.past.length - 1]
  if (!step) return null
  return { stack: { past: stack.past.slice(0, -1), future: [step, ...stack.future] }, apply: step.before }
}

export function redo(stack: LayoutStack): { stack: LayoutStack; apply: Record<string, XY> } | null {
  const step = stack.future[0]
  if (!step) return null
  return { stack: { past: [...stack.past, step], future: stack.future.slice(1) }, apply: step.after }
}
