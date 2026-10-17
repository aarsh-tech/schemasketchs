import { CircleAlert, CircleCheck, LoaderCircle, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useLintOff, useProblems } from '@/hooks/useProblems'
import { cx } from '@/lib/cx'
import { RULES } from '@/lib/lint'
import { useProjects } from '@/store/projects'
import { useUi } from '@/store/ui'
import { Popover } from './ui/primitives'

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
      {first ? null : <ProblemsButton />}
      <span className="hidden shrink-0 text-ink-3 lg:inline">Saved in this browser</span>
    </div>
  )
}

function ProblemsButton() {
  const { list } = useProblems()
  const [at, setAt] = useState<{ x: number; y: number; anchor: HTMLElement } | null>(null)
  const count = list.length

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={!!at}
        title="Schema checks: problems and settings"
        onClick={(e) => {
          if (at) return setAt(null)
          const r = e.currentTarget.getBoundingClientRect()
          setAt({ x: r.left, y: r.top - 8, anchor: e.currentTarget })
        }}
        className={cx(
          '-mx-1.5 inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 hover:bg-hover',
          count ? 'text-warn' : 'text-ink-3',
        )}
      >
        {count ? <TriangleAlert size={13} /> : <CircleCheck size={13} />}
        {count ? plural(count, 'problem') : 'No problems'}
      </button>
      {at ? <ProblemsPanel x={at.x} y={at.y} anchor={at.anchor} onClose={() => setAt(null)} /> : null}
    </>
  )
}

const RULE_TITLE = new Map(RULES.map((r) => [r.id, r.title]))

function ProblemsPanel({ x, y, anchor, onClose }: { x: number; y: number; anchor: HTMLElement | null; onClose: () => void }) {
  const { list } = useProblems()
  const off = useLintOff()
  const activeId = useProjects((s) => s.activeId)
  const tables = useUi((s) => s.model.tables)
  const [tab, setTab] = useState<'problems' | 'rules'>('problems')
  const label = (tableId: string, column: string | null) => {
    const t = tables.find((x) => x.id === tableId)
    const name = t ? (t.schema ? `${t.schema}.${t.name}` : t.name) : tableId
    return column ? `${name}.${column}` : name
  }

  return (
    <Popover x={x} y={y} above anchor={anchor} width={420} label="Schema checks" onClose={onClose} className="flex max-h-[min(420px,70vh)] flex-col">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5" role="tablist" aria-label="Schema checks">
        {(['problems', 'rules'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cx('h-7 rounded-md px-2.5 text-[12.5px] font-medium', tab === t ? 'bg-hover text-ink' : 'text-ink-2 hover:text-ink')}
          >
            {t === 'problems' ? `Problems (${list.length})` : 'Rules'}
          </button>
        ))}
      </div>
      {tab === 'problems' ? (
        list.length ? (
          <ul className="min-h-0 flex-1 overflow-y-auto p-1 scrollbar-thin">
            {list.map((p, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => {
                    useUi.getState().revealTable(p.tableId, p.column)
                    onClose()
                  }}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover"
                >
                  <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] leading-snug text-ink">{p.message}</span>
                    <span className="mt-0.5 block text-[11.5px] text-ink-3">
                      <span className="font-mono">{label(p.tableId, p.column)}</span> · {RULE_TITLE.get(p.rule)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-6 text-center text-[12.5px] text-ink-2">
            {off.length === RULES.length ? 'Every check is switched off for this schema.' : 'Nothing to report. The schema passes every check that’s on.'}
          </p>
        )
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-1 scrollbar-thin">
          <p className="px-2 pt-1 pb-2 text-[12px] text-ink-2">Switch checks on or off for this schema only.</p>
          {RULES.map((r) => (
            <label key={r.id} className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-hover">
              <input
                type="checkbox"
                checked={!off.includes(r.id)}
                onChange={(e) => useProjects.getState().setLintRule(activeId, r.id, e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-accent"
              />
              <span className="min-w-0">
                <span className="block text-[12.5px] font-medium text-ink">{r.title}</span>
                <span className="block text-[11.5px] leading-snug text-ink-2">{r.description}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </Popover>
  )
}
