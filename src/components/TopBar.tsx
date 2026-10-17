import { useReactFlow } from '@xyflow/react'
import {
  ChevronDown,
  CircleHelp,
  Copy,
  Database,
  FileCode,
  FilePlus,
  FileText,
  FolderOpen,
  GitCompareArrows,
  History,
  Image,
  Monitor,
  Moon,
  Radio,
  Save,
  Search,
  Share2,
  Sun,
  Tag,
  Trash2,
  Upload,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { downloadCode, downloadImage, downloadPdf, newProject, openFromDisk, save, share } from '@/lib/actions'
import { initials } from '@/lib/collab/link'
import { getLinkedFile } from '@/lib/files'
import { useCollab } from '@/store/collab'
import { useDialogs } from '@/store/dialogs'
import { useProjects } from '@/store/projects'
import { useUi } from '@/store/ui'
import type { ThemePref } from '@/store/ui'
import { LogoMark } from './Logo'
import { Button, IconButton, Menu } from './ui/primitives'
import { cx } from '@/lib/cx'
import type { MenuEntry } from './ui/primitives'

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

function timeAgo(t: number) {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

function ProjectName() {
  const project = useProjects((s) => s.projects[s.activeId])
  const rename = useProjects((s) => s.renameProject)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])

  if (!project) return null
  if (editing) {
    const commit = () => {
      rename(project.id, value)
      setEditing(false)
    }
    return (
      <input
        ref={input}
        value={value}
        aria-label="Schema name"
        maxLength={80}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
        className="h-8 w-48 rounded-md border border-accent bg-raised px-2 text-[14px] font-semibold outline-none sm:w-64"
      />
    )
  }
  return (
    <button
      type="button"
      title="Rename"
      onClick={() => {
        setValue(project.name)
        setEditing(true)
      }}
      className="h-8 max-w-[38vw] truncate rounded-md px-2 text-[14px] font-semibold tracking-[-0.01em] hover:bg-hover sm:max-w-[280px]"
    >
      {project.name}
    </button>
  )
}

function ProjectSwitcher() {
  const projects = useProjects((s) => s.projects)
  const activeId = useProjects((s) => s.activeId)
  const { setActive, duplicateProject } = useProjects.getState()

  const list = Object.values(projects).sort((a, b) => b.updatedAt - a.updatedAt)
  const items: MenuEntry[] = [
    { heading: 'Schemas in this browser' },
    ...list.map((p) => ({
      label: p.name,
      hint: p.id === activeId ? 'open' : timeAgo(p.updatedAt),
      onSelect: () => setActive(p.id),
    })),
    'separator',
    { label: 'New schema', icon: <FilePlus size={14} />, onSelect: () => newProject() },
    { label: 'Duplicate this schema', icon: <Copy size={14} />, onSelect: () => duplicateProject(activeId) },
    {
      label: 'Delete this schema',
      icon: <Trash2 size={14} />,
      danger: true,
      onSelect: () => useDialogs.getState().open({ type: 'delete-project', projectId: activeId }),
    },
  ]
  return (
    <Menu
      items={items}
      width={280}
      trigger={({ toggle, ref, open, id }) => (
        <IconButton id={id} ref={ref} label="Switch schema" aria-expanded={open} aria-haspopup="menu" onClick={toggle} className="-ml-1 h-7 w-7">
          <ChevronDown size={15} />
        </IconButton>
      )}
    />
  )
}

function LiveButton() {
  const status = useCollab((s) => s.status)
  const peers = useCollab((s) => s.peers)
  const activeId = useProjects((s) => s.activeId)
  const sharedHere = useCollab((s) => s.projectId === activeId)
  const open = () => useDialogs.getState().open({ type: 'live' })
  if (status === 'off') {
    return (
      <IconButton label="Start a live session" onClick={open} className="max-sm:hidden">
        <Radio size={16} />
      </IconButton>
    )
  }
  return (
    <button
      type="button"
      onClick={open}
      title={sharedHere ? 'Live session: people and link' : 'A live session is running on another schema'}
      className="ml-1 inline-flex h-8 items-center gap-1.5 rounded-md border border-accent/50 bg-accent-soft px-2 text-[12.5px] font-medium text-accent"
    >
      <span className={cx('h-2 w-2 rounded-full', status === 'live' ? 'bg-accent' : 'animate-pulse bg-ink-3')} aria-hidden />
      <span className="max-sm:hidden">Live</span>
      {peers.length ? (
        <span className="flex -space-x-1.5" aria-label={`${peers.length} others`}>
          {peers.slice(0, 3).map((p) => (
            <span key={p.id} className="flex h-5 w-5 items-center justify-center rounded-full border border-raised text-[9.5px] font-bold text-white" style={{ background: p.color }}>
              {initials(p.name)}
            </span>
          ))}
        </span>
      ) : null}
    </button>
  )
}

function ThemeToggle() {
  const theme = useUi((s) => s.theme)
  const setTheme = useUi((s) => s.setTheme)
  const order: ThemePref[] = ['system', 'light', 'dark']
  const next = order[(order.indexOf(theme) + 1) % order.length]
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor
  return (
    <IconButton label={`Theme: ${theme}. Switch to ${next}`} onClick={() => setTheme(next)}>
      <Icon size={16} />
    </IconButton>
  )
}

export function TopBar() {
  const rf = useReactFlow()
  const activeId = useProjects((s) => s.activeId)
  // re-render after saves so the linked file name shows up
  useProjects((s) => s.projects[s.activeId]?.updatedAt)
  const linked = getLinkedFile(activeId)

  const fileItems: MenuEntry[] = [
    { label: 'New schema', icon: <FilePlus size={14} />, onSelect: () => newProject() },
    { label: 'Open file…', icon: <FolderOpen size={14} />, hint: `${mod}O`, onSelect: () => void openFromDisk() },
    'separator',
    { label: linked ? `Save to ${linked}` : 'Save to file…', icon: <Save size={14} />, hint: `${mod}S`, onSelect: () => void save() },
    { label: 'Save as…', icon: <Save size={14} />, hint: `${mod}⇧S`, onSelect: () => void save(true) },
    'separator',
    { label: 'Save version…', icon: <Tag size={14} />, onSelect: () => useDialogs.getState().open({ type: 'history' }) },
    { label: 'Version history…', icon: <History size={14} />, onSelect: () => useDialogs.getState().open({ type: 'history' }) },
    { label: 'Generate migration…', icon: <GitCompareArrows size={14} />, onSelect: () => useDialogs.getState().open({ type: 'migration' }) },
    { label: 'Live session…', icon: <Radio size={14} />, onSelect: () => useDialogs.getState().open({ type: 'live' }) },
    'separator',
    { label: 'Import SQL, Prisma or Drizzle…', icon: <Upload size={14} />, onSelect: () => useDialogs.getState().open({ type: 'import' }) },
  ]

  const exportItems: MenuEntry[] = [
    { heading: 'Picture' },
    { label: 'PNG image', icon: <Image size={14} />, onSelect: () => void downloadImage(rf.getNodes(), 'png') },
    { label: 'SVG image', icon: <Image size={14} />, onSelect: () => void downloadImage(rf.getNodes(), 'svg') },
    { label: 'PDF, fitted to a page', icon: <FileText size={14} />, onSelect: () => void downloadPdf(rf.getNodes()) },
    { heading: 'Code' },
    { label: 'SQL, Prisma, Drizzle, types…', icon: <Database size={14} />, onSelect: () => useDialogs.getState().open({ type: 'export-code' }) },
    { label: 'Mermaid diagram', icon: <FileCode size={14} />, onSelect: () => useDialogs.getState().open({ type: 'export-code', format: 'mermaid' }) },
    { label: 'Markdown data dictionary', icon: <FileText size={14} />, onSelect: () => useDialogs.getState().open({ type: 'export-code', format: 'markdown' }) },
    { label: 'DBML file', icon: <FileCode size={14} />, onSelect: () => void downloadCode('dbml') },
    { label: 'Project file (with layout)', icon: <FileCode size={14} />, onSelect: () => void downloadCode('project') },
  ]

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line bg-panel px-2 sm:px-3">
      <div className="flex items-center gap-2 pr-1 sm:pr-2">
        <LogoMark />
        <span className="hidden text-[15px] font-bold tracking-[-0.02em] sm:inline">Schemasketch</span>
      </div>
      <div className="mx-1 hidden h-5 w-px bg-line sm:block" />
      <ProjectName />
      <ProjectSwitcher />

      <div className="flex-1" />

      <nav className="flex items-center gap-0.5" aria-label="Main">
        <Menu
          items={fileItems}
          trigger={({ toggle, ref, open, id }) => (
            <Button id={id} ref={ref} aria-haspopup="menu" aria-expanded={open} onClick={toggle} className={cx('max-sm:hidden', open && 'bg-hover text-ink')}>
              File
            </Button>
          )}
        />
        <Menu
          items={exportItems}
          align="end"
          trigger={({ toggle, ref, open, id }) => (
            <Button id={id} ref={ref} aria-haspopup="menu" aria-expanded={open} onClick={toggle} className={cx('max-sm:hidden', open && 'bg-hover text-ink')}>
              Export
            </Button>
          )}
        />
        {/* compact menu for phones */}
        <Menu
          items={[...fileItems, 'separator', ...exportItems]}
          align="end"
          width={250}
          trigger={({ toggle, ref, open, id }) => (
            <Button id={id} ref={ref} aria-haspopup="menu" aria-expanded={open} onClick={toggle} className="sm:hidden">
              Menu
            </Button>
          )}
        />
        <LiveButton />
        <Button variant="outline" onClick={share} className="ml-1">
          <Share2 size={14} />
          <span className="hidden sm:inline">Share</span>
        </Button>
        <div className="mx-1 h-5 w-px bg-line" />
        <IconButton label={`Search and commands (${mod}K)`} onClick={() => useDialogs.getState().open({ type: 'palette' })}>
          <Search size={16} />
        </IconButton>
        <IconButton label="Version history" onClick={() => useDialogs.getState().open({ type: 'history' })} className="max-sm:hidden">
          <History size={16} />
        </IconButton>
        <IconButton label="DBML help and shortcuts" onClick={() => useDialogs.getState().open({ type: 'help' })}>
          <CircleHelp size={16} />
        </IconButton>
        <ThemeToggle />
      </nav>
    </header>
  )
}
