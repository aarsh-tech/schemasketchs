import { useReactFlow } from '@xyflow/react'
import { ChevronDown, ListChecks, Network, Plus, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { IconButton, Menu } from '@/components/ui/primitives'
import type { MenuEntry } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'
import type { SchemaView } from '@/lib/views'
import { useDialogs } from '@/store/dialogs'
import { activeViewOf, useProjects } from '@/store/projects'
import { useUi } from '@/store/ui'
import { showRelated } from './editing'

const tabClass = (active: boolean) =>
  cx(
    'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium whitespace-nowrap',
    active ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-hover hover:text-ink',
  )

/** Tabs above the canvas: the full diagram, then each saved view. */
export function ViewTabs({ leading }: { leading?: ReactNode }) {
  const rf = useReactFlow()
  const views = useProjects((s) => s.projects[s.activeId]?.views) ?? []
  const active = useProjects((s) => activeViewOf(s.projects[s.activeId]))
  const tableCount = useUi((s) => s.model.tables.length)
  const { setActiveView } = useProjects.getState()

  const newView = () => {
    // tables selected on the canvas start the new view
    const picked = rf.getNodes().filter((n) => n.selected && n.type === 'table').map((n) => n.id)
    useDialogs.getState().open({ type: 'view', tableIds: picked })
  }

  const viewMenu = (v: SchemaView): MenuEntry[] => [
    { label: 'Edit name and tables…', icon: <ListChecks size={14} />, onSelect: () => useDialogs.getState().open({ type: 'view', viewId: v.id }) },
    { label: 'Show related tables', icon: <Network size={14} />, onSelect: () => showRelated(v) },
    'separator',
    {
      label: 'Delete view',
      icon: <Trash2 size={14} />,
      danger: true,
      onSelect: () => {
        useProjects.getState().deleteView(v.id)
        toast.success(`Deleted the ${v.name} view`, { description: 'Its tables are still in the schema.' })
      },
    },
  ]

  return (
    <nav aria-label="Views" className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-panel px-2 scrollbar-thin">
      {leading}
      <button type="button" aria-current={!active ? 'page' : undefined} className={tabClass(!active)} onClick={() => setActiveView(null)}>
        All tables
        <span className="font-mono text-[10.5px] opacity-70">{tableCount}</span>
      </button>
      {views.map((v) =>
        v.id === active?.id ? (
          <span key={v.id} className="inline-flex shrink-0 items-center">
            <button type="button" aria-current="page" className={cx(tabClass(true), 'rounded-r-none pr-1.5')} onClick={() => setActiveView(v.id)}>
              {v.name}
              <span className="font-mono text-[10.5px] opacity-70">{v.tableIds.length}</span>
            </button>
            <Menu
              items={viewMenu(v)}
              width={236}
              trigger={({ toggle, ref, open, id }) => (
                <button
                  id={id}
                  ref={ref}
                  type="button"
                  aria-label={`Options for the ${v.name} view`}
                  aria-haspopup="menu"
                  aria-expanded={open}
                  onClick={toggle}
                  className="inline-flex h-7 w-6 items-center justify-center rounded-r-md bg-accent-soft text-accent hover:brightness-95"
                >
                  <ChevronDown size={13} />
                </button>
              )}
            />
          </span>
        ) : (
          <button key={v.id} type="button" className={tabClass(false)} onClick={() => setActiveView(v.id)}>
            {v.name}
            <span className="font-mono text-[10.5px] opacity-70">{v.tableIds.length}</span>
          </button>
        ),
      )}
      <IconButton label="New view" onClick={newView} className="h-7 w-7">
        <Plus size={15} />
      </IconButton>
    </nav>
  )
}
