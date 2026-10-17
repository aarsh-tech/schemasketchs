import { useReactFlow } from '@xyflow/react'
import {
  CircleHelp,
  Columns3,
  Crosshair,
  Database,
  FileCode,
  FilePlus,
  FolderOpen,
  GitCompareArrows,
  Grid2x2Plus,
  History,
  Image,
  Layers,
  Map as MapIcon,
  Maximize,
  Monitor,
  Moon,
  Network,
  Save,
  Search,
  Share2,
  Sun,
  Table2,
  Tag,
  Upload,
  X,
} from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { addTable, goToTable } from '@/components/canvas/editing'
import { downloadCode, downloadImage, newProject, openFromDisk, save, share } from '@/lib/actions'
import { cx } from '@/lib/cx'
import { rank } from '@/lib/search'
import { useDialogs } from '@/store/dialogs'
import { useProjects } from '@/store/projects'
import type { SchemaView } from '@/store/projects'
import { useUi } from '@/store/ui'

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

const NO_VIEWS: SchemaView[] = []

interface Item {
  id: string
  kind: 'Table' | 'Column' | 'View' | 'Command'
  label: string
  detail?: string
  keywords?: string
  icon: ReactNode
  hint?: string
  /** keep the palette open afterwards (switching to picking a table) */
  stay?: boolean
  run: () => void
}

/** Ctrl/⌘+K: jump to a table or column, or run any command. */
export function CommandPalette({ dialog, onClose }: { dialog: { mode?: 'focus' } | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const open = !!dialog
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-label="Search and commands"
      onClose={() => {
        if (open) onClose()
      }}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className="mx-auto mt-[12vh] w-[calc(100vw-24px)] max-w-[620px] overflow-hidden rounded-xl border border-line bg-raised p-0 text-ink shadow-pop"
    >
      {dialog ? <PaletteBody key={dialog.mode ?? 'all'} initialMode={dialog.mode ?? 'all'} onClose={onClose} /> : null}
    </dialog>
  )
}

function PaletteBody({ initialMode, onClose }: { initialMode: 'all' | 'focus'; onClose: () => void }) {
  const rf = useReactFlow()
  const model = useUi((s) => s.model)
  const focus = useUi((s) => s.focus)
  const showMinimap = useUi((s) => s.showMinimap)
  const views = useProjects((s) => s.projects[s.activeId]?.views) ?? NO_VIEWS
  const [mode, setMode] = useState(initialMode)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  const listRef = useRef<HTMLUListElement>(null)

  const items = useMemo<Item[]>(() => {
    const ui = useUi.getState()
    const dialogs = useDialogs.getState()
    const tables: Item[] = model.tables.map((t) => ({
      id: `t:${t.id}`,
      kind: 'Table',
      label: t.id,
      detail: `${t.fields.length} ${t.fields.length === 1 ? 'column' : 'columns'}`,
      icon: <Table2 size={14} />,
      run: () =>
        mode === 'focus' ? ui.setFocus({ tableId: t.id, depth: ui.focus?.depth ?? 1, hide: ui.focus?.hide ?? false }) : goToTable(t.id),
    }))
    if (mode === 'focus') return tables

    const columns: Item[] = model.tables.flatMap((t) =>
      t.fields.map((f) => ({
        id: `c:${t.id}.${f.name}`,
        kind: 'Column' as const,
        label: `${t.id}.${f.name}`,
        detail: f.type,
        icon: <Columns3 size={14} />,
        run: () => goToTable(t.id, f.name),
      })),
    )
    const viewItems: Item[] = views.length
      ? [
          { id: 'v:all', kind: 'View', label: 'Show all tables', icon: <Layers size={14} />, keywords: 'view full diagram', run: () => useProjects.getState().setActiveView(null) },
          ...views.map(
            (v): Item => ({
              id: `v:${v.id}`,
              kind: 'View',
              label: `Show the ${v.name} view`,
              detail: `${v.tableIds.length} tables`,
              keywords: `view ${v.name}`,
              icon: <Layers size={14} />,
              run: () => useProjects.getState().setActiveView(v.id),
            }),
          ),
        ]
      : []
    const cmd = (id: string, label: string, icon: ReactNode, run: Item['run'], extra: Partial<Item> = {}): Item => ({ id: `x:${id}`, kind: 'Command', label, icon, run, ...extra })
    const commands: Item[] = [
      cmd('focus', 'Focus on a table…', <Crosshair size={14} />, () => {
        setMode('focus')
        setQuery('')
        setActive(0)
      }, { keywords: 'focus mode neighbours isolate', stay: true }),
      ...(focus ? [cmd('unfocus', 'Leave focus mode', <X size={14} />, () => ui.setFocus(null), { hint: 'Esc' })] : []),
      cmd('add-table', 'Add table', <Grid2x2Plus size={14} />, () => void addTable(), { keywords: 'new table create' }),
      cmd('layout', 'Arrange tables automatically', <Network size={14} />, ui.requestLayout, { keywords: 'auto layout tidy' }),
      cmd('fit', 'Fit diagram to screen', <Maximize size={14} />, ui.requestFit, { keywords: 'zoom' }),
      cmd('new-view', 'New view…', <Layers size={14} />, () => dialogs.open({ type: 'view' }), { keywords: 'subset tab' }),
      cmd('export-png', 'Export PNG image', <Image size={14} />, () => void downloadImage(rf.getNodes(), 'png'), { keywords: 'download picture' }),
      cmd('export-svg', 'Export SVG image', <Image size={14} />, () => void downloadImage(rf.getNodes(), 'svg'), { keywords: 'download picture vector' }),
      cmd('export-code', 'Export code…', <Database size={14} />, () => dialogs.open({ type: 'export-code' }), { keywords: 'sql prisma drizzle typescript zod postgres mysql' }),
      cmd('export-dbml', 'Download DBML file', <FileCode size={14} />, () => void downloadCode('dbml'), { keywords: 'export' }),
      cmd('export-project', 'Download project file (with layout)', <FileCode size={14} />, () => void downloadCode('project'), { keywords: 'export json' }),
      cmd('import', 'Import SQL, Prisma, Drizzle or a database…', <Upload size={14} />, () => dialogs.open({ type: 'import' })),
      cmd('share', 'Share a link…', <Share2 size={14} />, share, { keywords: 'url copy' }),
      cmd('new', 'New schema', <FilePlus size={14} />, () => newProject(), { keywords: 'project create' }),
      cmd('open', 'Open file…', <FolderOpen size={14} />, () => void openFromDisk(), { hint: `${mod}O` }),
      cmd('save', 'Save', <Save size={14} />, () => void save(), { hint: `${mod}S` }),
      cmd('save-as', 'Save as…', <Save size={14} />, () => void save(true), { hint: `${mod}⇧S` }),
      cmd('history', 'Version history…', <History size={14} />, () => dialogs.open({ type: 'history' }), { keywords: 'restore snapshot' }),
      cmd('save-version', 'Save version…', <Tag size={14} />, () => dialogs.open({ type: 'history' }), { keywords: 'snapshot label' }),
      cmd('migration', 'Generate migration…', <GitCompareArrows size={14} />, () => dialogs.open({ type: 'migration' }), { keywords: 'diff alter sql compare' }),
      cmd('minimap', showMinimap ? 'Hide minimap' : 'Show minimap', <MapIcon size={14} />, ui.toggleMinimap),
      cmd('cols-all', 'Show every column', <Columns3 size={14} />, () => ui.setDetail('all'), { keywords: 'detail columns' }),
      cmd('cols-keys', 'Show only key columns', <Columns3 size={14} />, () => ui.setDetail('keys'), { keywords: 'detail primary foreign' }),
      cmd('cols-names', 'Show table names only', <Columns3 size={14} />, () => ui.setDetail('name'), { keywords: 'detail compact' }),
      cmd('light', 'Use the light theme', <Sun size={14} />, () => ui.setTheme('light'), { keywords: 'theme colour' }),
      cmd('dark', 'Use the dark theme', <Moon size={14} />, () => ui.setTheme('dark'), { keywords: 'theme colour night' }),
      cmd('system', 'Match the system theme', <Monitor size={14} />, () => ui.setTheme('system'), { keywords: 'theme colour auto' }),
      cmd('help', 'DBML help and shortcuts', <CircleHelp size={14} />, () => dialogs.open({ type: 'help' }), { keywords: 'keyboard syntax' }),
    ]
    return [...tables, ...viewItems, ...commands, ...columns]
  }, [model, mode, focus, showMinimap, views, rf])

  // columns only show up once something is typed, there are too many to list
  const results = useMemo(() => rank(query, query.trim() ? items : items.filter((i) => i.kind !== 'Column'), 80), [query, items])
  const current = Math.min(active, results.length - 1)

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [current])

  const runItem = (item: Item | undefined) => {
    if (!item) return
    // close first, so a command that opens a dialog replaces this one
    if (!item.stay) onClose()
    item.run()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((current + step + results.length) % Math.max(results.length, 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runItem(results[current])
    } else if (e.key === 'Backspace' && !query && mode === 'focus' && initialMode === 'all') {
      setMode('all')
      setActive(0)
    }
  }

  return (
    <div className="flex max-h-[min(560px,76vh)] flex-col">
      <div className="flex items-center gap-2.5 border-b border-line px-3.5">
        {mode === 'focus' ? <Crosshair size={16} className="shrink-0 text-accent" aria-hidden /> : <Search size={16} className="shrink-0 text-ink-3" aria-hidden />}
        <input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={results[current] ? `${listId}-${current}` : undefined}
          aria-label={mode === 'focus' ? 'Focus on which table?' : 'Search tables, columns and commands'}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          placeholder={mode === 'focus' ? 'Focus on which table?' : 'Jump to a table or column, or run a command'}
          className="h-12 min-w-0 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-ink-3"
          spellCheck={false}
          autoComplete="off"
        />
        <kbd className="hidden rounded border border-line-strong px-1.5 font-mono text-[10.5px] text-ink-3 sm:inline">Esc</kbd>
      </div>
      <ul ref={listRef} id={listId} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-1.5 scrollbar-thin">
        {results.map((item, i) => (
          <li
            key={item.id}
            id={`${listId}-${i}`}
            data-index={i}
            role="option"
            aria-selected={i === current}
            onMouseMove={() => i !== current && setActive(i)}
            onClick={() => runItem(item)}
            className={cx('flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px]', i === current ? 'bg-accent-soft' : '')}
          >
            <span className={cx('flex w-4 shrink-0 justify-center', i === current ? 'text-accent' : 'text-ink-3')}>{item.icon}</span>
            <span className={cx('min-w-0 flex-1 truncate', item.kind === 'Table' || item.kind === 'Column' ? 'font-mono text-[12.5px]' : '')}>{item.label}</span>
            {item.detail ? <span className="max-w-[40%] shrink-0 truncate font-mono text-[11px] text-ink-3">{item.detail}</span> : null}
            {item.hint ? <span className="shrink-0 font-mono text-[11px] text-ink-3">{item.hint}</span> : null}
            <span className="hidden w-16 shrink-0 text-right text-[11px] text-ink-3 sm:inline">{item.kind}</span>
          </li>
        ))}
        {results.length === 0 ? (
          <li className="px-3 py-8 text-center text-[13px] text-ink-2">
            {model.tables.length === 0 && mode === 'focus' ? 'There are no tables to focus on yet.' : `Nothing matches “${query}”.`}
          </li>
        ) : null}
      </ul>
      <div className="flex items-center gap-3 border-t border-line bg-panel px-3.5 py-2 text-[11.5px] text-ink-3">
        <span>↑↓ to move</span>
        <span>Enter to {mode === 'focus' ? 'focus' : 'open'}</span>
        {mode === 'focus' && initialMode === 'all' ? <span>Backspace for everything</span> : null}
      </div>
    </div>
  )
}
