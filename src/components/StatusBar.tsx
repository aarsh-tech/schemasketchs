import { CircleAlert, LoaderCircle } from 'lucide-react'
import { useUi } from '@/store/ui'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function StatusBar() {
  const model = useUi((s) => s.model)
  const diagnostics = useUi((s) => s.diagnostics)
  const parsing = useUi((s) => s.parsing)
  const first = diagnostics[0]

  return (
    <div className="flex h-8 shrink-0 items-center gap-3 border-t border-line bg-panel px-3 text-[12px] text-ink-2" aria-live="polite">
      {first ? (
        <span className="flex min-w-0 items-center gap-1.5 text-danger" title={diagnostics.map((d) => `Line ${d.line}: ${d.message}`).join('\n')}>
          <CircleAlert size={13} className="shrink-0" />
          <span className="truncate">
            Line {first.line}: {first.message}
            {diagnostics.length > 1 ? ` (+${diagnostics.length - 1} more)` : ''}
          </span>
        </span>
      ) : (
        <span className="truncate">
          {plural(model.tables.length, 'table')}, {plural(model.refs.length, 'relationship')}
          {model.enums.length ? `, ${plural(model.enums.length, 'enum')}` : ''}
        </span>
      )}
      <span className="flex-1" />
      {parsing ? <LoaderCircle size={12} className="shrink-0 animate-spin text-ink-3" aria-label="Updating diagram" /> : null}
      <span className="hidden shrink-0 text-ink-3 md:inline">Saved in this browser</span>
    </div>
  )
}
