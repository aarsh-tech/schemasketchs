import { Panel } from '@xyflow/react'
import { Crosshair, X } from 'lucide-react'
import { useEffect } from 'react'
import { IconButton, Kbd, Segmented } from '@/components/ui/primitives'
import { useUi } from '@/store/ui'
import type { FocusMode } from '@/store/ui'

/** Shown over the canvas while focus mode is on. Escape leaves it. */
export function FocusBar({ focus, shown }: { focus: FocusMode; shown: number }) {
  const set = (patch: Partial<FocusMode>) => useUi.getState().setFocus({ ...focus, ...patch })
  const exit = () => useUi.getState().setFocus(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      // Escape inside the editor, a dialog or a menu belongs to them
      const t = e.target as HTMLElement | null
      if (t?.closest('.cm-editor, dialog, [role="menu"], [role="dialog"], input, textarea, select')) return
      useUi.getState().setFocus(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <Panel position="top-center" className="!mt-3 w-max max-w-[calc(100%-24px)]">
      <div role="region" aria-label="Focus mode" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-accent/40 bg-raised/95 p-1 pl-2.5 shadow-table backdrop-blur">
        <Crosshair size={14} className="shrink-0 text-accent" aria-hidden />
        <span className="max-w-48 truncate text-[12.5px]">
          <span className="text-ink-2">Focus on </span>
          <span className="font-mono font-semibold">{focus.tableId}</span>
          <span className="text-ink-3"> · {shown} {shown === 1 ? 'table' : 'tables'}</span>
        </span>
        <Segmented<'1' | '2' | '3'>
          label="Relationships away"
          value={String(focus.depth) as '1' | '2' | '3'}
          onChange={(v) => set({ depth: Number(v) as FocusMode['depth'] })}
          options={[
            { value: '1', label: '1', title: 'Tables one relationship away' },
            { value: '2', label: '2', title: 'Up to two relationships away' },
            { value: '3', label: '3', title: 'Up to three relationships away' },
          ]}
        />
        <Segmented<'dim' | 'hide'>
          label="Other tables"
          value={focus.hide ? 'hide' : 'dim'}
          onChange={(v) => set({ hide: v === 'hide' })}
          options={[
            { value: 'dim', label: 'Dim others' },
            { value: 'hide', label: 'Hide others' },
          ]}
        />
        <span className="hidden sm:inline">
          <Kbd>Esc</Kbd>
        </span>
        <IconButton label="Leave focus mode" onClick={exit} className="h-7 w-7">
          <X size={14} />
        </IconButton>
      </div>
    </Panel>
  )
}
