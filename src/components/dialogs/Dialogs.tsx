import { Copy, Download, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { copyText, downloadCode, errorText, generateCode, importSql, openProjectFile } from '@/lib/actions'
import type { ImportDialect, SqlDialect } from '@/lib/dbml/types'
import { baseName, clearShareHash } from '@/lib/files'
import { useDialogs } from '@/store/dialogs'
import { useProjects } from '@/store/projects'
import { Button, Dialog, Kbd, Segmented } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'

export function Dialogs() {
  const dialog = useDialogs((s) => s.dialog)
  const close = useDialogs((s) => s.close)
  return (
    <>
      <ImportSqlDialog
        key={dialog?.type === 'import-sql' ? `import:${dialog.fileName ?? ''}:${dialog.text?.length ?? 0}` : 'import:closed'}
        open={dialog?.type === 'import-sql'}
        initialText={dialog?.type === 'import-sql' ? dialog.text : undefined} fileName={dialog?.type === 'import-sql' ? dialog.fileName : undefined} onClose={close} />
      <ExportCodeDialog open={dialog?.type === 'export-code'} onClose={close} />
      <HelpDialog open={dialog?.type === 'help'} onClose={close} />
      <DeleteProjectDialog projectId={dialog?.type === 'delete-project' ? dialog.projectId : null} onClose={close} />
      <SharedLinkDialog dialog={dialog?.type === 'shared-link' ? dialog : null} onClose={close} />
      <ShareDialog url={dialog?.type === 'share' ? dialog.url : null} onClose={close} />
    </>
  )
}

/* ---------- import SQL ---------- */

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

function ImportSqlDialog({ open, initialText, fileName, onClose }: { open: boolean; initialText?: string; fileName?: string; onClose: () => void }) {
  // the parent remounts this dialog (via key) each time it opens, so initial state is enough
  const [sql, setSql] = useState(initialText ?? '')
  const [dialect, setDialect] = useState<ImportDialect>(() => (initialText ? guessDialect(initialText) : 'postgres'))
  const [mode, setMode] = useState<'new' | 'replace'>('new')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!sql.trim()) {
      setError('Paste some CREATE TABLE statements first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await importSql(sql, dialect, mode, fileName ? baseName(fileName) : undefined)
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={680}
      title={fileName ? `Import ${fileName}` : 'Import from SQL'}
      description="Paste CREATE TABLE statements. Schemasketch converts them to DBML; your SQL isn't sent anywhere."
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
      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        spellCheck={false}
        placeholder={'CREATE TABLE users (\n  id SERIAL PRIMARY KEY,\n  email VARCHAR(255) UNIQUE NOT NULL\n);'}
        className="mt-3 h-72 w-full resize-y rounded-lg border border-line-strong bg-panel p-3 font-mono text-[12.5px] leading-relaxed outline-none focus:border-accent"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit()
        }}
      />
      {error ? (
        <p role="alert" className="mt-2 rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
          {error}
        </p>
      ) : null}
    </Dialog>
  )
}

/* ---------- export code ---------- */

type CodeFormat = SqlDialect | 'dbml' | 'project'
const CODE_FORMATS: { value: CodeFormat; label: string }[] = [
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'mssql', label: 'SQL Server' },
  { value: 'oracle', label: 'Oracle' },
  { value: 'dbml', label: 'DBML' },
  { value: 'project', label: 'Project JSON' },
]

function ExportCodeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [format, setFormat] = useState<CodeFormat>('postgres')
  const [result, setResult] = useState<{ format: CodeFormat; code: string; error: string | null } | null>(null)
  const loading = result?.format !== format
  const code = result?.code ?? ''
  const error = loading ? null : (result?.error ?? null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    generateCode(format).then(
      (c) => !cancelled && setResult({ format, code: c, error: null }),
      (err) => !cancelled && setResult({ format, code: '', error: errorText(err) }),
    )
    return () => {
      cancelled = true
    }
  }, [open, format])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={760}
      title="Export code"
      description="Generated from the schema in the editor. Fix any errors there first."
      footer={
        <>
          <Button variant="outline" disabled={!code || !!error} onClick={() => copyText(code, 'Copied to clipboard')}>
            <Copy size={14} /> Copy
          </Button>
          <Button variant="primary" disabled={!code || !!error} onClick={() => downloadCode(format)}>
            <Download size={14} /> Download
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Format">
        {CODE_FORMATS.map((f) => (
          <button
            key={f.value}
            role="tab"
            type="button"
            aria-selected={format === f.value}
            onClick={() => setFormat(f.value)}
            className={cx(
              'h-7 rounded-md px-2.5 text-[12.5px] font-medium',
              format === f.value ? 'bg-accent text-accent-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
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
  ['Save', 'Ctrl / ⌘ + S'],
  ['Save as', 'Ctrl / ⌘ + Shift + S'],
  ['Open a file', 'Ctrl / ⌘ + O'],
  ['Find in editor', 'Ctrl / ⌘ + F'],
  ['Autocomplete', 'Ctrl + Space'],
  ['Zoom canvas', 'Ctrl / ⌘ + scroll, or pinch'],
  ['Select several tables', 'Shift + drag'],
  ['Jump to a table in the editor', 'Double-click it'],
]

function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} width={720} title="Writing DBML" description="Everything you need for most schemas. Drop a .dbml, .sql or .json file anywhere on the window to open it.">
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
              if (projectId) useProjects.getState().deleteProject(projectId)
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
