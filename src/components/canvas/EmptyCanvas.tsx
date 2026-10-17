import { ListChecks } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
import { useDialogs } from '@/store/dialogs'
import { useUi } from '@/store/ui'

const STARTER = `Table users {
  id integer [pk, increment]
  email varchar [unique, not null]
}

Table posts {
  id integer [pk]
  author_id integer [ref: > users.id]
  title varchar
}`

export function EmptyCanvas() {
  const hasErrors = useUi((s) => s.diagnostics.length > 0)
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">
          {hasErrors ? 'Fix the highlighted line to see your diagram' : 'Describe a table to start drawing'}
        </h2>
        <p className="mt-1.5 text-[13.5px] text-ink-2">
          {hasErrors
            ? 'The editor underlines the first problem it found. Hover it for details.'
            : 'Type DBML in the editor. Tables and their relationships appear here as you write.'}
        </p>
        {!hasErrors ? (
          <pre className="mt-4 rounded-lg border border-line bg-raised px-4 py-3 text-left font-mono text-[12px] leading-relaxed text-ink-2 shadow-table">
            {STARTER}
          </pre>
        ) : null}
      </div>
    </div>
  )
}

/** A view with no tables in it yet. */
export function EmptyView({ viewId }: { viewId: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <div className="pointer-events-auto max-w-sm text-center">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">This view has no tables yet</h2>
        <p className="mt-1.5 text-[13.5px] text-ink-2">Pick the tables it should show. They stay in the one schema; the view only keeps its own layout.</p>
        <Button variant="primary" className="mt-4" onClick={() => useDialogs.getState().open({ type: 'view', viewId })}>
          <ListChecks size={14} /> Choose tables
        </Button>
      </div>
    </div>
  )
}
