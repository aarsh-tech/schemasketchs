import { ArrowRight, ArrowRightLeft, Copy, Download, GitCompareArrows, History, LoaderCircle, Minus, Pencil, Plus, Radio, RotateCcw, ShieldCheck, Shuffle, Tag, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ClipboardEvent, FormEvent } from 'react'
import { copyText, downloadCode, errorText, generateCode, importSchema, openProjectFile, restoreVersion, saveVersion } from '@/lib/actions'
import type { CodeFormat } from '@/lib/actions'
import type { CatalogDialect } from '@/lib/catalog'
import type { SeedDialect } from '@/lib/seed'
import type { OrmTarget } from '@/lib/convert'
import { parseDbml } from '@/lib/dbml/client'
import type { ImportDialect, ParseDiagnostic, SchemaModel } from '@/lib/dbml/types'
import type { ChangeKind, MigrationDialect, SummaryItem } from '@/lib/diff'
import { baseName, clearShareHash, downloadText, guessTextKind, slug } from '@/lib/files'
import { IDLE_MS, deleteVersions, describeDelta, tableDelta } from '@/lib/history'
import { neighbours } from '@/lib/views'
import { liveHash } from '@/lib/collab/link'
import { useCollab } from '@/store/collab'
import type { Version } from '@/lib/history'
import { useHistory } from '@/store/history'
import { useDialogs } from '@/store/dialogs'
import type { ImportFormat } from '@/store/dialogs'
import { useProjects } from '@/store/projects'
import { useUi } from '@/store/ui'
import { CommandPalette } from '@/components/CommandPalette'
import { Button, Dialog, IconButton, Kbd, Segmented, Tabs } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'

export function Dialogs() {
  const dialog = useDialogs((s) => s.dialog)
  const close = useDialogs((s) => s.close)
  return (
    <>
      <ImportDialog
        key={dialog?.type === 'import' ? `import:${dialog.format ?? ''}:${dialog.fileName ?? ''}:${dialog.text?.length ?? 0}` : 'import:closed'}
        open={dialog?.type === 'import'}
        initial={dialog?.type === 'import' ? dialog : {}}
        onClose={close}
      />
      <ExportCodeDialog
        key={dialog?.type === 'export-code' ? `export:${dialog.format ?? ''}` : 'export:closed'}
        open={dialog?.type === 'export-code'}
        initialFormat={dialog?.type === 'export-code' ? dialog.format : undefined}
        onClose={close}
      />
      <HelpDialog open={dialog?.type === 'help'} onClose={close} />
      <DeleteProjectDialog projectId={dialog?.type === 'delete-project' ? dialog.projectId : null} onClose={close} />
      <SharedLinkDialog dialog={dialog?.type === 'shared-link' ? dialog : null} onClose={close} />
      <ShareDialog url={dialog?.type === 'share' ? dialog.url : null} onClose={close} />
      <HistoryDialog open={dialog?.type === 'history'} onClose={close} />
      <MigrationDialog dialog={dialog?.type === 'migration' ? dialog : null} onClose={close} />
      <ViewDialog dialog={dialog?.type === 'view' ? dialog : null} onClose={close} />
      <CommandPalette dialog={dialog?.type === 'palette' ? dialog : null} onClose={close} />
      <LiveDialog open={dialog?.type === 'live'} onClose={close} />
      <SeedDialog open={dialog?.type === 'seed'} onClose={close} />
      <LiveJoinDialog dialog={dialog?.type === 'live-join' ? dialog : null} onClose={close} />
    </>
  )
}

/* ---------- import ---------- */

const IMPORT_DIALECTS: { value: ImportDialect; label: string }[] = [
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'mssql', label: 'SQL Server' },
  { value: 'snowflake', label: 'Snowflake' },
  { value: 'oracle', label: 'Oracle' },
  { value: 'schemarb', label: 'Rails schema.rb' },
]

function guessDialect(sql: string): ImportDialect {
  if (/ActiveRecord::Schema|create_table\s+"/.test(sql)) return 'schemarb'
  if (/`\w+`|ENGINE\s*=|AUTO_INCREMENT/i.test(sql)) return 'mysql'
  if (/\[\w+\]|NVARCHAR|IDENTITY\s*\(/i.test(sql)) return 'mssql'
  if (/VARCHAR2|NUMBER\s*\(/i.test(sql)) return 'oracle'
  return 'postgres'
}

const IMPORT_FORMATS: { value: ImportFormat; label: string; description: string; placeholder: string }[] = [
  {
    value: 'sql',
    label: 'SQL',
    description: 'Paste CREATE TABLE statements or a Rails schema.rb. Schemasketch converts them to DBML in your browser; nothing is uploaded.',
    placeholder: 'CREATE TABLE users (\n  id SERIAL PRIMARY KEY,\n  email VARCHAR(255) UNIQUE NOT NULL\n);',
  },
  {
    value: 'prisma',
    label: 'Prisma',
    description: 'Paste a schema.prisma file. Models, enums, relations, indexes and @map names become DBML in your browser; nothing is uploaded.',
    placeholder: 'model User {\n  id    Int    @id @default(autoincrement())\n  email String @unique\n  posts Post[]\n}',
  },
  {
    value: 'drizzle',
    label: 'Drizzle',
    description: 'Paste a Drizzle schema file (pg-core, mysql-core or sqlite-core). Tables, enums, references and indexes become DBML in your browser; nothing is uploaded.',
    placeholder: "export const users = pgTable('users', {\n  id: serial('id').primaryKey(),\n  email: varchar('email', { length: 255 }).notNull().unique(),\n})",
  },
  {
    value: 'database',
    label: 'Database',
    description: 'Read the schema of a live database without connecting to it: run a read-only query in your own client, then paste back the JSON it returns.',
    placeholder: 'Paste the JSON the query returns, starting with {"dialect": …\n\nOr drop the saved .json result anywhere on the window.',
  },
]

function ImportDialog({ open, initial, onClose }: { open: boolean; initial: { format?: ImportFormat; text?: string; fileName?: string }; onClose: () => void }) {
  // the parent remounts this dialog (via key) each time it opens, so initial state is enough
  const [text, setText] = useState(initial.text ?? '')
  const [format, setFormat] = useState<ImportFormat>(initial.format ?? 'sql')
  const [dialect, setDialect] = useState<ImportDialect>(() => (initial.text ? guessDialect(initial.text) : 'postgres'))
  const [mode, setMode] = useState<'new' | 'replace'>('new')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const current = IMPORT_FORMATS.find((f) => f.value === format)!

  const submit = async () => {
    if (!text.trim()) {
      setError(format === 'database' ? 'Run the query above in your database client, then paste the JSON it returns.' : `Paste a ${format === 'sql' ? 'SQL' : current.label} schema first.`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await importSchema(format, text, { dialect, mode, name: initial.fileName ? baseName(initial.fileName) : undefined })
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  // pasting into an empty box picks the matching tab
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (text.trim()) return
    const pasted = e.clipboardData.getData('text')
    const kind = guessTextKind(pasted)
    if (kind) setFormat(kind)
    if (kind === 'sql' || (!kind && format === 'sql')) setDialect(guessDialect(pasted))
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={680}
      title={initial.fileName ? `Import ${initial.fileName}` : 'Import a schema'}
      description={current.description}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            {busy ? <LoaderCircle size={14} className="animate-spin" /> : null}
            {mode === 'new' ? 'Import as new schema' : 'Replace current schema'}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Tabs label="Import from" value={format} onChange={setFormat} options={IMPORT_FORMATS} />
        <div className="flex-1" />
        <Segmented
          label="Where to import"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'new', label: 'New schema' },
            { value: 'replace', label: 'Replace current' },
          ]}
        />
      </div>
      {format === 'sql' ? (
        <div className="mt-3 flex items-center gap-2">
          <label className="text-[12.5px] text-ink-2" htmlFor="import-dialect">
            Dialect
          </label>
          <select
            id="import-dialect"
            value={dialect}
            onChange={(e) => setDialect(e.target.value as ImportDialect)}
            className="h-8 rounded-md border border-line-strong bg-raised px-2 text-[13px]"
          >
            {IMPORT_DIALECTS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {format === 'database' ? <CatalogQuery /> : null}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={onPaste}
        spellCheck={false}
        aria-label={format === 'database' ? 'Query result to import' : `${current.label} to import`}
        placeholder={current.placeholder}
        className={cx(
          'mt-3 w-full resize-y rounded-lg border border-line-strong bg-panel p-3 font-mono text-[12.5px] leading-relaxed outline-none focus:border-accent',
          format === 'database' ? 'h-36' : 'h-72',
        )}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit()
        }}
      />
      {error ? (
        <p role="alert" className="mt-2 rounded-md bg-danger-soft px-3 py-2 text-[12.5px] whitespace-pre-wrap text-danger">
          {error}
        </p>
      ) : null}
    </Dialog>
  )
}

/** The read-only catalog query for each database, to copy and run elsewhere. */
function CatalogQuery() {
  const [dialect, setDialect] = useState<CatalogDialect>(() => (/mysql|maria/i.test(useUi.getState().model.databaseType ?? '') ? 'mysql' : 'postgres'))
  // the queries live in the lazily loaded catalog module
  const [catalog, setCatalog] = useState<typeof import('@/lib/catalog') | null>(null)
  useEffect(() => {
    let cancelled = false
    void import('@/lib/catalog').then((m) => !cancelled && setCatalog(m))
    return () => {
      cancelled = true
    }
  }, [])
  const query = catalog?.CATALOG_QUERIES[dialect] ?? ''

  return (
    <div className="mt-3 grid gap-2">
      <p className="flex items-start gap-2 rounded-md border border-line bg-accent-soft px-3 py-2 text-[12.5px] text-ink">
        <ShieldCheck size={15} className="mt-px shrink-0 text-accent" aria-hidden />
        <span>
          Schemasketch never connects to your database. You run the query yourself; it only reads the schema, never your data. The JSON you paste back is read in this
          browser and nothing is uploaded.
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Database"
          value={dialect}
          onChange={setDialect}
          options={[
            { value: 'postgres', label: 'PostgreSQL' },
            { value: 'mysql', label: 'MySQL' },
            { value: 'sqlite', label: 'SQLite' },
            { value: 'mssql', label: 'SQL Server' },
          ]}
        />
        <div className="flex-1" />
        <Button size="sm" variant="outline" disabled={!query} onClick={() => copyText(query, 'Query copied')}>
          <Copy size={13} /> Copy query
        </Button>
        <Button size="sm" variant="outline" disabled={!query} onClick={() => downloadText(query, `schemasketch-catalog.${dialect}.sql`, 'application/sql')}>
          <Download size={13} /> .sql
        </Button>
      </div>
      <pre
        tabIndex={0}
        aria-label={`Catalog query for ${dialect}`}
        className="h-32 overflow-auto rounded-lg border border-line bg-panel p-3 font-mono text-[11.5px] leading-relaxed text-ink-2 scrollbar-thin"
      >
        {query || 'Loading…'}
      </pre>
      {catalog ? <p className="text-[12px] text-ink-2">{catalog.CATALOG_HOWTO[dialect]}</p> : null}
    </div>
  )
}

/* ---------- export code ---------- */

const CODE_FORMATS: ({ value: CodeFormat; label: string } | 'separator')[] = [
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'mssql', label: 'SQL Server' },
  { value: 'oracle', label: 'Oracle' },
  'separator',
  { value: 'prisma', label: 'Prisma' },
  { value: 'drizzle', label: 'Drizzle' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'zod', label: 'Zod' },
  'separator',
  { value: 'mermaid', label: 'Mermaid' },
  { value: 'markdown', label: 'Markdown docs' },
  'separator',
  { value: 'dbml', label: 'DBML' },
  { value: 'project', label: 'Project JSON' },
]

const TARGETS: Partial<Record<CodeFormat, { value: OrmTarget; label: string }[]>> = {
  prisma: [
    { value: 'postgres', label: 'PostgreSQL' },
    { value: 'mysql', label: 'MySQL' },
    { value: 'sqlite', label: 'SQLite' },
  ],
  drizzle: [
    { value: 'postgres', label: 'pg-core' },
    { value: 'mysql', label: 'mysql-core' },
  ],
}

/** The database the schema says it targets, from its Project database_type. */
function targetFor(databaseType: string | null): OrmTarget {
  if (/mysql|maria/i.test(databaseType ?? '')) return 'mysql'
  if (/sqlite/i.test(databaseType ?? '')) return 'sqlite'
  return 'postgres'
}

function ExportCodeDialog({ open, initialFormat, onClose }: { open: boolean; initialFormat?: CodeFormat; onClose: () => void }) {
  const databaseType = useUi((s) => s.model.databaseType)
  const [format, setFormat] = useState<CodeFormat>(initialFormat ?? 'postgres')
  // null follows the schema's database_type until someone picks a target
  const [picked, setPicked] = useState<OrmTarget | null>(null)
  const targets = TARGETS[format]
  const preferred = picked ?? targetFor(databaseType)
  const target = targets ? (targets.some((t) => t.value === preferred) ? preferred : targets[0].value) : 'postgres'
  const key = `${format}:${target}`
  const [result, setResult] = useState<{ key: string; code: string; error: string | null } | null>(null)
  const loading = result?.key !== key
  const code = result?.code ?? ''
  const error = loading ? null : (result?.error ?? null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    generateCode(format, target).then(
      (c) => !cancelled && setResult({ key: `${format}:${target}`, code: c, error: null }),
      (err) => !cancelled && setResult({ key: `${format}:${target}`, code: '', error: errorText(err) }),
    )
    return () => {
      cancelled = true
    }
  }, [open, format, target])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={760}
      title="Export code"
      description={
        format === 'mermaid'
          ? 'A Mermaid erDiagram. Paste it inside a ```mermaid block and GitHub or GitLab draws it.'
          : format === 'markdown'
            ? 'A data dictionary: every table with its columns, types, keys, notes and relationships, with a Mermaid diagram on top.'
            : 'Generated from the schema in the editor. Fix any errors there first.'
      }
      footer={
        <>
          <Button variant="outline" disabled={!code || !!error} onClick={() => copyText(code, 'Copied to clipboard')}>
            <Copy size={14} /> Copy
          </Button>
          <Button variant="primary" disabled={!code || !!error} onClick={() => downloadCode(format, target)}>
            <Download size={14} /> Download
          </Button>
        </>
      }
    >
      <Tabs label="Format" value={format} onChange={setFormat} options={CODE_FORMATS} />
      {targets ? (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[12.5px] text-ink-2" id="export-target">
            {format === 'prisma' ? 'Provider' : 'Dialect'}
          </span>
          <Segmented label={format === 'prisma' ? 'Provider' : 'Dialect'} value={target} onChange={setPicked} options={targets} />
        </div>
      ) : null}
      <div className="relative mt-3">
        {error ? (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
            {error}
          </p>
        ) : (
          <pre
            className={cx(
              'h-[52vh] overflow-auto rounded-lg border border-line bg-panel p-3 font-mono text-[12px] leading-relaxed text-ink scrollbar-thin',
              loading && 'opacity-50',
            )}
          >
            {code}
          </pre>
        )}
      </div>
    </Dialog>
  )
}

/* ---------- help ---------- */

const CHEATSHEET = `Table users as U {
  id integer [pk, increment]      // primary key
  email varchar [unique, not null]
  role user_role [default: 'member']
  created_at timestamp [default: \`now()\`]
  Note: 'Shown on the table card'
}

Enum user_role {
  admin
  member
}

// relationships:  >  many-to-one   <  one-to-many
//                 -  one-to-one    <> many-to-many
Ref: posts.author_id > users.id [delete: cascade]

Table posts [headercolor: #3B6EA5] {
  author_id integer
  editor_id integer [ref: > users.id]   // inline ref
}

TableGroup content {
  posts
}

Note todo {
  'Sticky note on the canvas'
}`

const SHORTCUTS: [string, string][] = [
  ['Search tables, columns and commands', 'Ctrl / ⌘ + K'],
  ['Save', 'Ctrl / ⌘ + S'],
  ['Save as', 'Ctrl / ⌘ + Shift + S'],
  ['Open a file', 'Ctrl / ⌘ + O'],
  ['Find in editor', 'Ctrl / ⌘ + F'],
  ['Autocomplete', 'Ctrl + Space'],
  ['Zoom canvas', 'Ctrl / ⌘ + scroll, or pinch'],
  ['Select several tables', 'Shift + drag'],
  ['Jump to a table in the editor', 'Double-click it'],
  ['Table actions (rename, colour, delete)', 'Right-click it'],
  ['Edit a column', 'Click it'],
  ['Relate two columns', 'Drag a column’s dot onto another'],
  ['Delete a selected relationship', 'Delete'],
  ['Undo a diagram edit', 'Ctrl / ⌘ + Z in the editor'],
  ['Undo or redo a table move', 'Ctrl / ⌘ + Z, Ctrl / ⌘ + Shift + Z on the canvas'],
  ['Focus on a table and its neighbours', 'Right-click it, then Focus'],
  ['Leave focus mode', 'Esc'],
]

function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} width={720} title="Writing DBML" description="Everything you need for most schemas. Drop a .dbml, .sql, .prisma, Drizzle .ts or project .json file anywhere on the window to open it.">
      <div className="grid gap-5 md:grid-cols-[1.35fr_1fr]">
        <pre className="overflow-auto rounded-lg border border-line bg-panel p-3 font-mono text-[11.5px] leading-relaxed text-ink scrollbar-thin">{CHEATSHEET}</pre>
        <div>
          <h3 className="mb-2 text-[13px] font-semibold">Shortcuts</h3>
          <dl className="space-y-2">
            {SHORTCUTS.map(([what, keys]) => (
              <div key={what} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                <dt className="text-ink-2">{what}</dt>
                <dd>
                  <Kbd>{keys}</Kbd>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[12.5px] text-ink-2">
            Your schemas live in this browser's storage. Save to a file to keep a copy or move it to another machine. Full syntax:{' '}
            <a className="text-accent underline underline-offset-2" href="https://dbml.dbdiagram.io/docs" target="_blank" rel="noreferrer">
              dbml.dbdiagram.io/docs
            </a>
          </p>
        </div>
      </div>
    </Dialog>
  )
}

/* ---------- delete ---------- */

function DeleteProjectDialog({ projectId, onClose }: { projectId: string | null; onClose: () => void }) {
  const project = useProjects((s) => (projectId ? s.projects[projectId] : undefined))
  return (
    <Dialog
      open={!!projectId}
      onClose={onClose}
      width={440}
      title={`Delete ${project?.name ?? 'schema'}?`}
      description="This removes it from this browser. Files you saved to disk aren't affected."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            autoFocus
            onClick={() => {
              if (projectId) {
                useProjects.getState().deleteProject(projectId)
                void deleteVersions(projectId)
              }
              onClose()
            }}
          >
            Delete schema
          </Button>
        </>
      }
    />
  )
}

/* ---------- incoming share link ---------- */

function SharedLinkDialog({ dialog, onClose }: { dialog: { file: import('@/lib/files').ProjectFile } | null; onClose: () => void }) {
  const done = () => {
    clearShareHash()
    onClose()
  }
  const tables = dialog ? (dialog.file.source.match(/^\s*Table\s/gim)?.length ?? 0) : 0
  return (
    <Dialog
      open={!!dialog}
      onClose={done}
      width={460}
      title={`Open ${dialog?.file.name ?? 'shared schema'}?`}
      description={`Someone shared a schema with ${tables} ${tables === 1 ? 'table' : 'tables'}. It opens as a new schema; nothing you have is changed.`}
      footer={
        <>
          <Button onClick={done}>Not now</Button>
          <Button
            variant="primary"
            autoFocus
            onClick={() => {
              if (dialog) openProjectFile(dialog.file)
              done()
            }}
          >
            Open schema
          </Button>
        </>
      }
    />
  )
}

/* ---------- outgoing share link ---------- */

function ShareDialog({ url, onClose }: { url: string | null; onClose: () => void }) {
  const long = (url?.length ?? 0) > 8000
  return (
    <Dialog
      open={!!url}
      onClose={onClose}
      width={560}
      title="Share a link"
      description="The whole schema and layout are packed into the link itself. No server stores it, so anyone with the link can open a copy."
      footer={
        <>
          <Button onClick={onClose}>Done</Button>
          <Button variant="primary" onClick={() => url && copyText(url, 'Link copied')}>
            <Copy size={14} /> Copy link
          </Button>
        </>
      }
    >
      <textarea
        readOnly
        value={url ?? ''}
        onFocus={(e) => e.currentTarget.select()}
        className="h-24 w-full resize-none rounded-lg border border-line-strong bg-panel p-2.5 font-mono text-[11.5px] break-all text-ink-2 outline-none"
      />
      {long ? (
        <p className="mt-2 text-[12.5px] text-ink-2">
          This link is {Math.round((url?.length ?? 0) / 1000)}k characters long. Some chat apps cut long links; for big schemas, send the saved file instead.
        </p>
      ) : null}
    </Dialog>
  )
}

/* ---------- version history ---------- */

function formatWhen(t: number): string {
  const d = new Date(t)
  const now = new Date()
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const dayDiff = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000)
  if (dayDiff === 0) return `Today, ${time}`
  if (dayDiff === 1) return `Yesterday, ${time}`
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
  return `${date}, ${time}`
}

function HistoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={940}
      title="Version history"
      description={`A snapshot is taken after ${IDLE_MS / 1000} seconds without edits and kept in this browser. Labelled versions are never removed.`}
    >
      <HistoryBody onClose={onClose} />
    </Dialog>
  )
}

function HistoryBody({ onClose }: { onClose: () => void }) {
  const versions = useHistory((s) => s.versions)
  const loading = useHistory((s) => s.loading)
  const current = useProjects((s) => s.projects[s.activeId]?.source ?? '')
  const [picked, setPicked] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const index = Math.max(0, versions.findIndex((v) => v.id === picked))
  const selected = versions[index] ?? null

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    await saveVersion(label)
    setSaving(false)
    setLabel('')
    setPicked(null)
  }

  return (
    <div className="grid gap-4">
      <form onSubmit={save} className="flex flex-wrap items-center gap-2">
        <label htmlFor="version-label" className="sr-only">
          Label for this version
        </label>
        <input
          id="version-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={80}
          placeholder="Label, e.g. Before billing changes (optional)"
          className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-panel px-2.5 text-[13px] outline-none focus:border-accent"
        />
        <Button type="submit" variant="outline" disabled={saving}>
          {saving ? <LoaderCircle size={14} className="animate-spin" /> : <Tag size={14} />}
          Save version
        </Button>
      </form>

      {loading ? (
        <p className="text-[13px] text-ink-2">Loading versions…</p>
      ) : versions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center">
          <History size={20} className="mx-auto text-ink-3" />
          <p className="mt-2 text-[13.5px] font-medium">No versions yet</p>
          <p className="mt-1 text-[12.5px] text-ink-2">Keep editing and one is saved when you pause, or save one now with a label.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[280px_1fr]">
          <ol className="max-h-[28vh] overflow-y-auto rounded-lg border border-line p-1 scrollbar-thin md:max-h-[56vh]" aria-label="Versions, newest first">
            {versions.map((v, i) => (
              <li key={v.id}>
                <button
                  type="button"
                  aria-current={v === selected}
                  onClick={() => setPicked(v.id)}
                  className={cx(
                    'flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left',
                    v === selected ? 'bg-accent-soft' : 'hover:bg-hover',
                  )}
                >
                  <span className="flex w-full items-baseline gap-2">
                    <span className="truncate text-[13px] font-medium">{v.label ?? 'Automatic snapshot'}</span>
                    {v.label ? <Tag size={11} className="shrink-0 text-key" aria-label="labelled" /> : null}
                  </span>
                  <span className="flex w-full justify-between gap-2 text-[11.5px] text-ink-2">
                    <span>{formatWhen(v.createdAt)}</span>
                    <span className="font-mono text-ink-3">{describeDelta(tableDelta(versions, i))}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {selected ? (
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold">{selected.label ?? 'Automatic snapshot'}</div>
                  <div className="text-[12px] text-ink-2">
                    {formatWhen(selected.createdAt)} · {selected.tableCount} {selected.tableCount === 1 ? 'table' : 'tables'} ·{' '}
                    {selected.source.split('\n').length} lines
                  </div>
                </div>
                <Button
                  variant="outline"
                  disabled={selected.source === current}
                  title={selected.source === current ? 'This is what the editor has now' : 'See the SQL that turns this version into the current schema'}
                  onClick={() => useDialogs.getState().open({ type: 'migration', from: `v:${selected.id}`, to: 'current' })}
                >
                  <GitCompareArrows size={14} /> Compare with current
                </Button>
                <Button
                  variant="primary"
                  disabled={selected.source === current}
                  title={selected.source === current ? 'This is what the editor has now' : undefined}
                  onClick={() => {
                    void restoreVersion(selected)
                    onClose()
                  }}
                >
                  <RotateCcw size={14} /> {selected.source === current ? 'Same as now' : 'Restore this version'}
                </Button>
              </div>
              <pre
                aria-label="Read-only preview of this version"
                className="h-[40vh] overflow-auto rounded-lg border border-line bg-panel p-3 font-mono text-[12px] leading-relaxed text-ink scrollbar-thin md:h-[50vh]"
              >
                {selected.source}
              </pre>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

/* ---------- seed data ---------- */

const SEED_DIALECTS: { value: SeedDialect; label: string }[] = [
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'sqlite', label: 'SQLite' },
  { value: 'mssql', label: 'SQL Server' },
]

function SeedDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={860}
      title="Generate seed data"
      description="Realistic INSERT statements for every table, in an order that satisfies the foreign keys, with values that fit each column's name, type and constraints."
    >
      {open ? <SeedBody /> : null}
    </Dialog>
  )
}

function SeedBody() {
  const model = useUi((s) => s.model)
  const hasErrors = useUi((s) => s.diagnostics.length > 0)
  const projectName = useProjects((s) => s.projects[s.activeId]?.name ?? 'schema')
  const [mod, setMod] = useState<typeof import('@/lib/seed') | null>(null)
  useEffect(() => {
    let cancelled = false
    void import('@/lib/seed').then((m) => !cancelled && setMod(m))
    return () => {
      cancelled = true
    }
  }, [])
  const [dialect, setDialect] = useState<SeedDialect>(() => {
    const db = useUi.getState().model.databaseType ?? ''
    return /mysql|maria/i.test(db) ? 'mysql' : /sqlite/i.test(db) ? 'sqlite' : /sql ?server|mssql/i.test(db) ? 'mssql' : 'postgres'
  })
  const [all, setAll] = useState('10')
  const [rows, setRows] = useState<Record<string, string>>({})
  const [seed, setSeed] = useState(1)
  const count = (id: string) => {
    const n = Number(rows[id] ?? all)
    return Number.isFinite(n) ? Math.max(0, Math.min(mod?.MAX_ROWS ?? 5000, Math.floor(n))) : 0
  }
  const result = useMemo(() => {
    if (!mod || !model.tables.length) return null
    const r: Record<string, number> = {}
    for (const t of model.tables) {
      const n = Number(rows[t.id] ?? all)
      r[t.id] = Number.isFinite(n) ? n : 0
    }
    return mod.generateSeed(model, { dialect, rows: r, seed })
  }, [mod, model, rows, all, dialect, seed])
  const total = result ? Object.values(result.counts).reduce((a, b) => a + b, 0) : 0
  const preview = result && result.sql.length > 200_000 ? `${result.sql.slice(0, 200_000)}\n-- … preview cut here; Copy and Download include everything` : (result?.sql ?? '')
  const fileName = `${slug(projectName)}-seed.${dialect}.sql`

  if (!model.tables.length) return <p className="text-[13px] text-ink-2">Add some tables first; there's nothing to fill yet.</p>

  return (
    <div className="grid gap-3">
      {hasErrors ? (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-[12.5px]">The code has an error, so this uses the last version of the schema that worked.</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Database" value={dialect} onChange={setDialect} options={SEED_DIALECTS} />
        <div className="flex-1" />
        <label htmlFor="seed-all" className="text-[12.5px] text-ink-2">
          Rows per table
        </label>
        <input
          id="seed-all"
          type="number"
          min={0}
          max={mod?.MAX_ROWS ?? 5000}
          value={all}
          onChange={(e) => {
            setAll(e.target.value)
            setRows({})
          }}
          className="h-8 w-20 rounded-md border border-line-strong bg-panel px-2 text-[13px] tabular-nums outline-none focus:border-accent"
        />
        <Button variant="outline" onClick={() => setSeed(Math.floor(Math.random() * 1_000_000) + 2)} title="Make different values">
          <Shuffle size={14} /> Shuffle
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-[240px_1fr]">
        <ul className="max-h-[22vh] overflow-y-auto rounded-lg border border-line p-1 scrollbar-thin md:max-h-[50vh]" aria-label="Rows for each table">
          {model.tables.map((t) => (
            <li key={t.id} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-hover">
              <label htmlFor={`seed-${t.id}`} className="min-w-0 flex-1 truncate font-mono text-[12px]">
                {t.id}
              </label>
              <input
                id={`seed-${t.id}`}
                type="number"
                min={0}
                value={rows[t.id] ?? all}
                onChange={(e) => setRows((r) => ({ ...r, [t.id]: e.target.value }))}
                className="h-7 w-16 rounded border border-line-strong bg-panel px-1.5 text-right text-[12.5px] tabular-nums outline-none focus:border-accent"
              />
              {result && result.counts[t.id] < count(t.id) ? (
                <TriangleAlert size={12} className="shrink-0 text-warn" aria-label={`only ${result.counts[t.id]} rows`} />
              ) : null}
            </li>
          ))}
        </ul>
        <div className="flex min-w-0 flex-col gap-2">
          {result?.warnings.length ? (
            <ul className="grid gap-1 rounded-md bg-warn-soft px-3 py-2 text-[12px]" aria-label="Warnings">
              {result.warnings.map((w) => (
                <li key={w} className="flex gap-1.5">
                  <TriangleAlert size={12} className="mt-0.5 shrink-0 text-warn" aria-hidden /> {w}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] text-ink-2">{result ? `${total.toLocaleString()} rows in ${model.tables.length} tables` : 'Loading the generator…'}</span>
            <div className="flex-1" />
            <Button variant="outline" disabled={!result} onClick={() => result && copyText(result.sql, 'Seed SQL copied')}>
              <Copy size={14} /> Copy
            </Button>
            <Button variant="primary" disabled={!result} onClick={() => result && downloadText(result.sql, fileName, 'application/sql')}>
              <Download size={14} /> Download .sql
            </Button>
          </div>
          <pre tabIndex={0} aria-label="Seed SQL" className="h-[38vh] overflow-auto rounded-lg border border-line bg-panel p-3 font-mono text-[11.5px] leading-relaxed text-ink scrollbar-thin md:h-[44vh]">
            {preview}
          </pre>
        </div>
      </div>
    </div>
  )
}

/* ---------- live sessions ---------- */

const PRIVACY = 'Edits travel straight between browsers over WebRTC, encrypted with a key that only exists in the link. Public signalling servers only help browsers find each other; they see the encrypted connection setup, never your schema.'

function LiveDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const status = useCollab((s) => s.status)
  return (
    <Dialog open={open} onClose={onClose} width={560} title={status === 'off' ? 'Start a live session' : 'Live session'} description={PRIVACY}>
      {open ? <LiveBody onClose={onClose} /> : null}
    </Dialog>
  )
}

function LiveBody({ onClose }: { onClose: () => void }) {
  const c = useCollab()
  const activeId = useProjects((s) => s.activeId)
  const sharedName = useProjects((s) => (c.projectId ? s.projects[c.projectId]?.name : null))
  const [name, setName] = useState(c.name)
  const [signaling, setSignaling] = useState(c.signaling)
  const [busy, setBusy] = useState(false)
  const link = c.room && c.key ? `${location.origin}${location.pathname}#${liveHash(c.room, c.key, c.servers)}` : ''

  const nameField = (
    <div className="grid gap-1">
      <label htmlFor="live-name" className="text-[12px] font-medium text-ink-2">
        Your name, shown to the others
      </label>
      <input
        id="live-name"
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => c.setName(name)}
        className="h-8 rounded-md border border-line-strong bg-panel px-2.5 text-[13px] outline-none focus:border-accent"
      />
    </div>
  )

  if (c.status === 'off') {
    return (
      <div className="grid gap-3">
        {nameField}
        <details className="rounded-lg border border-line px-3 py-2 text-[12.5px]">
          <summary className="cursor-pointer font-medium text-ink-2">Signalling servers</summary>
          <p className="mt-2 text-ink-2">
            One per line. Everyone in a session must use the same one. Tabs in this browser always find each other; people on other devices need a server both can reach. Run your own with <code className="font-mono">pnpm signaling</code> (or <code className="font-mono">npx y-webrtc</code>), then enter its ws:// address here.
          </p>
          <textarea
            value={signaling}
            onChange={(e) => setSignaling(e.target.value)}
            onBlur={() => c.setSignaling(signaling)}
            aria-label="Signalling server addresses"
            spellCheck={false}
            className="mt-2 h-16 w-full resize-y rounded-md border border-line-strong bg-panel p-2 font-mono text-[12px] outline-none focus:border-accent"
          />
        </details>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              c.setName(name)
              c.setSignaling(signaling)
              await useCollab.getState().start()
              setBusy(false)
            }}
          >
            {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Radio size={14} />} Start live session
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      {c.projectId !== activeId ? (
        <p className="rounded-md bg-hover px-3 py-2 text-[12.5px] text-ink-2">
          The session shares <span className="font-medium text-ink">{sharedName}</span>.{' '}
          <button type="button" className="text-accent underline underline-offset-2" onClick={() => c.projectId && useProjects.getState().setActive(c.projectId)}>
            Switch to it
          </button>
        </p>
      ) : null}
      <div className="grid gap-1">
        <span className="text-[12px] font-medium text-ink-2">Invite link</span>
        <div className="flex gap-2">
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-panel px-2.5 font-mono text-[12px] text-ink-2 outline-none" />
          <Button variant="primary" onClick={() => copyText(link, 'Invite link copied')}>
            <Copy size={14} /> Copy
          </Button>
        </div>
      </div>
      <p className={cx('flex items-start gap-2 rounded-md px-3 py-2 text-[12.5px]', c.signalingOk === false ? 'bg-warn-soft text-ink' : 'bg-accent-soft text-ink')}>
        <span className={cx('mt-1 h-2 w-2 shrink-0 rounded-full', c.signalingOk === false ? 'bg-warn' : c.signalingOk ? 'bg-accent' : 'animate-pulse bg-ink-3')} aria-hidden />
        {c.signalingOk === false
          ? 'Can’t reach a signalling server, so only tabs in this browser can join. Add a server you can reach when starting the next session.'
          : c.signalingOk
            ? 'Connected. Anyone with the link can join while you’re here.'
            : 'Connecting…'}
      </p>
      <div className="grid gap-1">
        <span className="text-[12px] font-medium text-ink-2">In this session</span>
        <ul className="grid gap-1">
          <li className="flex items-center gap-2 text-[13px]">
            <span className="h-3 w-3 rounded-full" style={{ background: c.color }} aria-hidden /> {c.name} <span className="text-ink-3">(you)</span>
          </li>
          {c.peers.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-[13px]">
              <span className="h-3 w-3 rounded-full" style={{ background: p.color }} aria-hidden /> {p.name}
              {p.table ? <span className="font-mono text-[11.5px] text-ink-3">on {p.table}</span> : null}
            </li>
          ))}
          {c.peers.length === 0 ? <li className="text-[12.5px] text-ink-3">Nobody else yet. Send them the link.</li> : null}
        </ul>
      </div>
      {nameField}
      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <Button
          variant="outline"
          className="text-danger"
          onClick={() => {
            c.leave()
            onClose()
          }}
        >
          Leave session
        </Button>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  )
}

function LiveJoinDialog({ dialog, onClose }: { dialog: { room: string; key: string; signaling: string[] } | null; onClose: () => void }) {
  const notNow = () => {
    history.replaceState(null, '', location.pathname + location.search)
    onClose()
  }
  return (
    <Dialog
      open={!!dialog}
      onClose={notNow}
      width={480}
      title="Join a live session?"
      description="Someone invited you to edit a schema together. It opens as a schema in this browser, and your edits are shared while you're in the session. When you leave, you keep a copy."
      footer={
        <>
          <Button onClick={notNow}>Not now</Button>
          <Button
            variant="primary"
            autoFocus
            onClick={() => {
              if (dialog) void useCollab.getState().join(dialog.room, dialog.key, dialog.signaling)
              onClose()
            }}
          >
            <Radio size={14} /> Join session
          </Button>
        </>
      }
    >
      <p className="text-[12.5px] text-ink-2">{PRIVACY}</p>
    </Dialog>
  )
}

/* ---------- views ---------- */

function ViewDialog({ dialog, onClose }: { dialog: { viewId?: string; tableIds?: string[] } | null; onClose: () => void }) {
  const view = useProjects((s) => (dialog?.viewId ? s.projects[s.activeId]?.views?.find((v) => v.id === dialog.viewId) : undefined))
  const editing = !!dialog?.viewId
  return (
    <Dialog
      open={!!dialog}
      onClose={onClose}
      width={520}
      title={editing ? `Edit the ${view?.name ?? ''} view` : 'New view'}
      description="A view shows some of the schema's tables with a layout of its own. The schema itself stays in one place."
    >
      {dialog ? <ViewForm key={dialog.viewId ?? 'new'} viewId={dialog.viewId} initial={view?.tableIds ?? dialog.tableIds ?? []} name={view?.name ?? ''} onClose={onClose} /> : null}
    </Dialog>
  )
}

function ViewForm({ viewId, initial, name: initialName, onClose }: { viewId?: string; initial: string[]; name: string; onClose: () => void }) {
  const tables = useUi((s) => s.model.tables)
  const model = useUi((s) => s.model)
  const [name, setName] = useState(initialName)
  const [picked, setPicked] = useState(() => new Set(initial))
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const shown = tables.filter((t) => t.id.toLowerCase().includes(filter.trim().toLowerCase()))
  const toggle = (id: string, on: boolean) =>
    setPicked((cur) => {
      const next = new Set(cur)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  // keep ids for tables that are missing right now (say, mid-rename), so saving doesn't drop them
  const missing = initial.filter((id) => !tables.some((t) => t.id === id))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('Give the view a name, for example Billing.')
    const ids = [...tables.map((t) => t.id).filter((id) => picked.has(id)), ...missing.filter((id) => picked.has(id))]
    const store = useProjects.getState()
    if (viewId) store.updateView(viewId, { name, tableIds: ids })
    else store.createView(name, ids)
    onClose()
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-1">
        <label htmlFor="view-name" className="text-[12px] font-medium text-ink-2">
          Name
        </label>
        <input
          id="view-name"
          autoFocus
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Auth, Billing, Catalogue"
          className="h-8 rounded-md border border-line-strong bg-panel px-2.5 text-[13px] outline-none focus:border-accent"
        />
      </div>
      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-medium text-ink-2">
            Tables <span className="font-normal text-ink-3">({picked.size} of {tables.length})</span>
          </span>
          <span className="flex-1" />
          <Button
            size="sm"
            disabled={!picked.size}
            title="Add every table one relationship away from the ones picked"
            onClick={() => {
              const extra = neighbours(model, [...picked])
              setPicked((cur) => new Set([...cur, ...extra]))
            }}
          >
            Add related
          </Button>
          <Button size="sm" onClick={() => setPicked(new Set(shown.map((t) => t.id).concat([...picked])))}>
            Select {filter ? 'shown' : 'all'}
          </Button>
          <Button size="sm" onClick={() => setPicked(new Set())}>
            Clear
          </Button>
        </div>
        <label htmlFor="view-filter" className="sr-only">
          Filter tables
        </label>
        <input
          id="view-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter tables"
          className="h-8 rounded-md border border-line-strong bg-panel px-2.5 text-[13px] outline-none focus:border-accent"
        />
        <ul className="max-h-[40vh] overflow-y-auto rounded-lg border border-line p-1 scrollbar-thin" aria-label="Tables in this view">
          {shown.map((t) => (
            <li key={t.id}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] hover:bg-hover">
                <input type="checkbox" checked={picked.has(t.id)} onChange={(e) => toggle(t.id, e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{t.id}</span>
                <span className="text-[11.5px] text-ink-3">{t.fields.length} cols</span>
              </label>
            </li>
          ))}
          {shown.length === 0 ? <li className="px-2 py-3 text-center text-[12.5px] text-ink-2">No table matches “{filter}”.</li> : null}
        </ul>
      </div>
      {error ? (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary">
          {viewId ? 'Save view' : 'Create view'}
        </Button>
      </div>
    </form>
  )
}

/* ---------- migration generator ---------- */

/** 'current', 'pasted' or 'v:<version id>' */
type Side = string

type Parsed = { model: SchemaModel | null; diagnostics: ParseDiagnostic[] }

function sideLabel(side: Side, versions: Version[]): string {
  if (side === 'current') return 'Current schema'
  if (side === 'pasted') return 'Pasted DBML'
  const v = versions.find((x) => `v:${x.id}` === side)
  return v ? (v.label ?? `Snapshot from ${formatWhen(v.createdAt)}`) : 'Missing version'
}

function MigrationDialog({ dialog, onClose }: { dialog: { from?: Side; to?: Side } | null; onClose: () => void }) {
  return (
    <Dialog
      open={!!dialog}
      onClose={onClose}
      width={1000}
      title="Generate migration"
      description="Compare two versions of this schema and get the SQL that turns one into the other. Nothing leaves your browser."
    >
      {dialog ? <MigrationBody key={`${dialog.from ?? ''}>${dialog.to ?? ''}`} initialFrom={dialog.from} initialTo={dialog.to} /> : null}
    </Dialog>
  )
}

const KIND_ICON: Record<ChangeKind, { icon: typeof Plus; className: string; label: string }> = {
  add: { icon: Plus, className: 'text-accent', label: 'Added' },
  remove: { icon: Minus, className: 'text-danger', label: 'Removed' },
  change: { icon: Pencil, className: 'text-ref', label: 'Changed' },
  rename: { icon: ArrowRight, className: 'text-ref', label: 'Renamed' },
}

function MigrationBody({ initialFrom, initialTo }: { initialFrom?: Side; initialTo?: Side }) {
  const versions = useHistory((s) => s.versions)
  const project = useProjects((s) => s.projects[s.activeId])
  const current = project?.source ?? ''
  const [from, setFrom] = useState<Side>(() => {
    if (initialFrom) return initialFrom
    // the newest version that differs from what's in the editor, if there is one
    const older = versions.find((v) => v.source !== current)
    return older ? `v:${older.id}` : 'pasted'
  })
  const [to, setTo] = useState<Side>(initialTo ?? 'current')
  const [pasted, setPasted] = useState('')
  const [dialect, setDialect] = useState<MigrationDialect>(() => (/mysql/i.test(useUi.getState().model.databaseType ?? '') ? 'mysql' : 'postgres'))
  const [direction, setDirection] = useState<'up' | 'down'>('up')
  const [detectRenames, setDetectRenames] = useState(true)

  const sourceOf = (side: Side) => (side === 'current' ? current : side === 'pasted' ? pasted : (versions.find((v) => `v:${v.id}` === side)?.source ?? ''))
  const fromSource = sourceOf(from)
  const toSource = sourceOf(to)

  const [result, setResult] = useState<{ fromSource: string; toSource: string; mod: typeof import('@/lib/diff') | null; a: Parsed; b: Parsed } | null>(null)
  const loading = result?.fromSource !== fromSource || result?.toSource !== toSource

  useEffect(() => {
    let cancelled = false
    // short pause so typing in the paste box doesn't parse on every key
    const t = setTimeout(() => {
      Promise.all([import('@/lib/diff'), parseDbml(fromSource), parseDbml(toSource)]).then(
        ([mod, a, b]) => !cancelled && setResult({ fromSource, toSource, mod, a, b }),
        (err) => {
          const failed: Parsed = { model: null, diagnostics: [{ message: errorText(err), line: 1, column: 1, endLine: 1, endColumn: 2 }] }
          if (!cancelled) setResult({ fromSource, toSource, mod: null, a: failed, b: failed })
        },
      )
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [fromSource, toSource])

  const title = `${sideLabel(from, versions)} → ${sideLabel(to, versions)}`
  const migration = useMemo(() => {
    if (!result?.mod || !result.a.model || !result.b.model) return null
    return result.mod.generateMigration(result.a.model, result.b.model, dialect, { detectRenames, title })
  }, [result, dialect, detectRenames, title])
  const summary = useMemo<SummaryItem[]>(() => (migration && result?.mod ? result.mod.summarize(migration.diff) : []), [migration, result])

  const parseError = (() => {
    if (!result) return null
    for (const [side, parsed] of [[from, result.a], [to, result.b]] as const) {
      const d = parsed.diagnostics[0]
      if (!parsed.model && d) return `${sideLabel(side, versions)} has an error on line ${d.line}: ${d.message}. Fix it before comparing.`
    }
    return null
  })()
  const needsPaste = (from === 'pasted' || to === 'pasted') && !pasted.trim()
  const sql = migration?.[direction] ?? ''
  const destructive = summary.filter((s) => s.risk === 'destructive').length
  const fileName = `${slug(project?.name ?? 'schema')}-${direction}.${dialect}.sql`

  const sidePicker = (id: string, label: string, value: Side, onChange: (s: Side) => void) => (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label htmlFor={id} className="text-[12px] font-medium text-ink-2">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-full min-w-0 rounded-md border border-line-strong bg-raised px-2 text-[13px]">
        <option value="current">Current schema</option>
        <option value="pasted">Pasted DBML</option>
        {versions.length ? (
          <optgroup label="Saved versions">
            {versions.map((v) => (
              <option key={v.id} value={`v:${v.id}`}>
                {v.label ? `${v.label} · ${formatWhen(v.createdAt)}` : `Snapshot · ${formatWhen(v.createdAt)}`}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </div>
  )

  return (
    <div className="grid gap-3">
      <div className="flex items-end gap-2">
        {sidePicker('migration-from', 'From (before)', from, setFrom)}
        <IconButton
          label="Swap before and after"
          onClick={() => {
            setFrom(to)
            setTo(from)
          }}
        >
          <ArrowRightLeft size={15} />
        </IconButton>
        {sidePicker('migration-to', 'To (after)', to, setTo)}
      </div>

      {from === 'pasted' || to === 'pasted' ? (
        <div>
          <label htmlFor="migration-paste" className="sr-only">
            DBML to compare
          </label>
          <textarea
            id="migration-paste"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            spellCheck={false}
            placeholder={'Paste DBML here, e.g. the schema from your main branch\n\nTable users {\n  id integer [pk]\n}'}
            className="h-32 w-full resize-y rounded-lg border border-line-strong bg-panel p-3 font-mono text-[12.5px] leading-relaxed outline-none focus:border-accent"
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Segmented
          label="SQL dialect"
          value={dialect}
          onChange={setDialect}
          options={[
            { value: 'postgres', label: 'PostgreSQL' },
            { value: 'mysql', label: 'MySQL' },
          ]}
        />
        <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2" title="Treat a dropped table and a new table with mostly the same columns as one renamed table">
          <input type="checkbox" checked={detectRenames} onChange={(e) => setDetectRenames(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
          Detect renamed tables
        </label>
      </div>

      {parseError ? (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
          {parseError}
        </p>
      ) : needsPaste ? (
        <div className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-[12.5px] text-ink-2">Paste some DBML above to compare against it.</div>
      ) : !migration ? (
        <p className="flex items-center gap-2 text-[13px] text-ink-2">
          <LoaderCircle size={14} className="animate-spin" /> Comparing…
        </p>
      ) : (
        <div className={cx('grid gap-3', loading && 'opacity-60')}>
          <section aria-label="Changes" className="rounded-lg border border-line">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
              <h3 className="text-[13px] font-semibold">{summary.length ? `${summary.length} ${summary.length === 1 ? 'change' : 'changes'}` : 'No differences'}</h3>
              {destructive ? (
                <span className="inline-flex items-center gap-1 rounded bg-danger-soft px-1.5 py-px text-[11.5px] font-medium text-danger">
                  <TriangleAlert size={11} /> {destructive} can lose data
                </span>
              ) : null}
            </div>
            {summary.length ? (
              <ul className="max-h-[24vh] overflow-y-auto p-1 scrollbar-thin">
                {summary.map((item, i) => {
                  const k = KIND_ICON[item.kind]
                  return (
                    <li key={i} className="flex items-start gap-2 rounded-md px-2 py-1 text-[12.5px]">
                      <k.icon size={13} className={cx('mt-0.5 shrink-0', k.className)} aria-label={k.label} />
                      <div className="min-w-0 flex-1">
                        <span className="font-mono text-[12px] break-all text-ink">{item.subject}</span> <span className="text-ink-2">{item.text}</span>
                        {item.note ? <div className={cx('text-[11.5px]', item.risk === 'destructive' ? 'text-danger' : 'text-key')}>{item.note}</div> : null}
                      </div>
                      {item.risk ? (
                        <span
                          className={cx(
                            'shrink-0 rounded px-1.5 py-px text-[11px] font-medium',
                            item.risk === 'destructive' ? 'bg-danger-soft text-danger' : 'border border-line-strong text-key',
                          )}
                        >
                          {item.risk === 'destructive' ? 'Data loss' : 'Check'}
                        </span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="px-3 py-3 text-[12.5px] text-ink-2">Both sides have the same tables, columns, indexes, enums and relationships.</p>
            )}
          </section>

          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Script"
              value={direction}
              onChange={setDirection}
              options={[
                { value: 'up', label: 'Up', title: 'Before → after' },
                { value: 'down', label: 'Down', title: 'After → before, to undo it' },
              ]}
            />
            <span className="hidden text-[12px] text-ink-3 sm:inline">{direction === 'up' ? 'Applies the change' : 'Undoes the change'}</span>
            <div className="flex-1" />
            <Button variant="outline" disabled={!sql} onClick={() => copyText(sql, 'SQL copied')}>
              <Copy size={14} /> Copy
            </Button>
            <Button variant="primary" disabled={!sql} onClick={() => downloadText(sql, fileName, 'application/sql')}>
              <Download size={14} /> Download .sql
            </Button>
          </div>
          <pre
            aria-label={`${direction === 'up' ? 'Up' : 'Down'} migration SQL`}
            tabIndex={0}
            className="h-[40vh] overflow-auto rounded-lg border border-line bg-panel p-3 font-mono text-[12px] leading-relaxed text-ink scrollbar-thin"
          >
            {sql}
          </pre>
        </div>
      )}
    </div>
  )
}
