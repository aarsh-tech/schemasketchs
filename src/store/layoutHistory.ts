import { create } from 'zustand'
import { EMPTY_STACK, record, redo, undo } from '@/lib/layoutHistory'
import type { LayoutStack, LayoutStep } from '@/lib/layoutHistory'
import type { XY } from '@/lib/views'

/** Canvas undo/redo stacks, one per project and view. Kept in memory only. */
interface LayoutHistoryState {
  stacks: Record<string, LayoutStack>
  record: (key: string, step: LayoutStep) => void
  /** Pops a step and returns the positions to apply, or null when there's nothing to do. */
  take: (key: string, dir: 'undo' | 'redo') => Record<string, XY> | null
}

export const useLayoutHistory = create<LayoutHistoryState>((set, get) => ({
  stacks: {},
  record: (key, step) => set((s) => ({ stacks: { ...s.stacks, [key]: record(s.stacks[key] ?? EMPTY_STACK, step) } })),
  take(key, dir) {
    const res = (dir === 'undo' ? undo : redo)(get().stacks[key] ?? EMPTY_STACK)
    if (!res) return null
    set((s) => ({ stacks: { ...s.stacks, [key]: res.stack } }))
    return res.apply
  },
}))
