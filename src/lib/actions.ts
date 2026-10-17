import type { Node } from '@xyflow/react'
import { toast } from 'sonner'
import { editorText, replaceEditorText, undoInEditor } from '@/components/editor/bridge'
import type { OrmExportFormat, OrmTarget } from '@/lib/convert'
import { editDbml, exportSql, importToDbml, parseDbml } from '@/lib/dbml/client'
import type { SchemaEdit } from '@/lib/dbml/edit'
import type { ImportDialect, SqlDialect } from '@/lib/dbml/types'
import { renderDiagram } from '@/lib/exportImage'
import {
  baseName,
  buildShareUrl,
  downloadDataUrl,
  downloadText,
  guessKind,
  linkFile,
  parseProjectFile,
  pickFile,
  saveProject,
  slug,
  toProjectFile,
} from '@/lib/files'
import type { ProjectFile } from '@/lib/files'
import type { Version } from '@/lib/history'
import { useHistory } from '@/store/history'
import { useDialogs } from '@/store/dialogs'
import type { ImportFormat } from '@/store/dialogs'
import { useProjects } from '@/store/projects'
import { useUi } from '@/store/ui'

const active = () => {
  const s = useProjects.getState()
  return s.projects[s.activeId]
}

/** Replace the text/layout of the current project and make editor + canvas start fresh. */
export function replaceActive(patch: { source: string; positions?: ProjectFile['positions']; name?: string }) {
  const p = active()
  if (!p) return
  useProjects.getState().replaceProject(p.id, { source: patch.source, positions: patch.positions ?? {}, ...(patch.name ? { name: patch.name } : {}) })
  useUi.getState().resetModel()
  useUi.getState().bumpEditor()
}

export function newProject(source = '', name?: string) {
  useProjects.getState().createProject({ name: name ?? 'Untitled schema', source })
  useUi.getState().setMobileView('editor')
}

export function openProjectFile(file: ProjectFile) {
  useProjects.getState().createProject({ name: file.name, source: file.source, positions: file.positions })
}

/* ---------- edits made on the canvas ---------- */

export type EditResult = { ok: true } | { ok: false; error: string }

/**
 * Apply a canvas edit to the DBML. The change goes through the editor, so it
 * shows up there and Ctrl+Z undoes it. Errors are toasted unless `quiet`
 * (popovers show them inline instead).
 */
export async function editSchema(edit: SchemaEdit, opts: { quiet?: boolean; done?: string; undoable?: boolean } = {}): Promise<EditResult> {
  const fail = (error: string): EditResult => {
    if (!opts.quiet) toast.error('Couldn’t change the schema', { description: error })
    return { ok: false, error }
  }
  if (useUi.getState().diagnostics.length) {
    return fail('The code has an error, so the diagram can’t be edited right now. Fix the underlined line in the editor first.')
  }
  // if someone types while the worker is busy, redo the edit on the new text
  for (let attempt = 0; attempt < 3; attempt++) {
    const p = active()
    if (!p) return fail('There is no schema open.')
    const before = editorText() ?? p.source
    let next: string
    try {
      next = await editDbml(before, edit)
    } catch (err) {
      return fail(errorText(err))
    }
    if (next === before) return { ok: true }
    if (!replaceEditorText(before, next)) {
      if (editorText() !== null) continue
      // no editor mounted: write straight to the project
      useProjects.getState().setSource(next)
      useUi.getState().bumpEditor()
    }
    if (opts.done) toast.success(opts.done, opts.undoable ? { action: { label: 'Undo', onClick: () => undoInEditor() } } : undefined)
    return { ok: true }
  }
  return fail('The code kept changing while the edit was being made. Try again.')
}

/* ---------- version history ---------- */

export async function saveVersion(label: string) {
  const p = active()
  if (!p) return
  try {
    await useHistory.getState().snapshot(p.id, { auto: false, label })
    toast.success(label.trim() ? `Saved version “${label.trim()}”` : 'Saved a version')
  } catch (err) {
    toast.error('Could not save the version', { description: `${errorText(err)}. Your browser may be out of storage space.` })
  }
}

/**
 * Bring back a version's code and layout. The current state is snapshotted
 * first, and the code change goes through the editor, so Ctrl+Z works too.
 */
export async function restoreVersion(version: Version) {
  const p = active()
  if (!p) return
  try {
    await useHistory.getState().snapshot(p.id, { auto: true })
  } catch {
    /* restoring matters more than the safety copy */
  }
  const before = editorText()
  if (before === null || !replaceEditorText(before, version.source)) {
    replaceActive({ source: version.source, positions: version.positions })
  } else {
    useProjects.getState().setPositions(version.positions, { replace: true })
    useUi.getState().bumpCanvas()
  }
  toast.success(`Restored the version from ${new Date(version.createdAt).toLocaleString()}`, {
    description: 'Your previous state was saved to the history first.',
  })
}

/* ---------- open ---------- */

export async function openFromDisk() {
  try {
    const file = await pickFile()
    if (file) handleIncomingFile(file.name, file.text, file.handle)
  } catch (err) {
    toast.error('Could not open that file', { description: errorText(err) })
  }
}

export function handleIncomingFile(name: string, text: string, handle?: FileSystemFileHandle) {
  const kind = guessKind(name, text)
  if (kind === 'project') {
    const file = parseProjectFile(text)
    if (!file) {
      toast.error(`${name} isn't a Schemasketch project file`, { description: 'Project files are saved from File → Save as… with the .json type.' })
      return
    }
    openProjectFile(file)
    toast.success(`Opened ${file.name}`)
    return
  }
  if (kind === 'sql' || kind === 'prisma' || kind === 'drizzle') {
    useDialogs.getState().open({ type: 'import', format: kind, text, fileName: name })
    return
  }
  const id = useProjects.getState().createProject({ name: baseName(name), source: text })
  if (handle) linkFile(id, handle)
  toast.success(`Opened ${name}`, handle ? { description: 'Saving now writes back to this file.' } : undefined)
}

/* ---------- save ---------- */

export async function save(saveAs = false) {
  const p = active()
  if (!p) return
  try {
    const name = await saveProject(p, { saveAs })
    if (name) toast.success(`Saved ${name}`)
  } catch (err) {
    toast.error('Could not save the file', { description: errorText(err) })
  }
}

/* ---------- import SQL, Prisma, Drizzle ---------- */

const FORMAT_LABEL: Record<ImportFormat, string> = { sql: 'SQL', prisma: 'Prisma', drizzle: 'Drizzle' }

export async function importSchema(format: ImportFormat, text: string, opts: { dialect: ImportDialect; mode: 'new' | 'replace'; name?: string }) {
  let dbml: string
  let warnings: string[] = []
  if (format === 'sql') dbml = await importToDbml(text, opts.dialect)
  else {
    const { importOrm } = await import('@/lib/convert')
    const result = importOrm(format, text)
    dbml = result.dbml
    warnings = result.warnings
  }
  if (opts.mode === 'replace') replaceActive({ source: dbml })
  else useProjects.getState().createProject({ name: opts.name ?? 'Imported schema', source: dbml })
  const what = FORMAT_LABEL[format]
  const title = opts.mode === 'replace' ? `Replaced the schema with the imported ${what}` : `Imported ${what} into a new schema`
  if (warnings.length) {
    toast.warning(title, { description: `${warnings.length === 1 ? 'One thing' : `${warnings.length} things`} couldn't be converted. They're listed in a comment at the top of the code.` })
  } else toast.success(title)
}

/* ---------- export ---------- */

export type CodeFormat = SqlDialect | OrmExportFormat | 'dbml' | 'project'

const ORM_FORMATS = new Set<CodeFormat>(['prisma', 'drizzle', 'typescript', 'zod'])

/** Code for the current schema. `target` picks the database for Prisma and Drizzle. */
export async function generateCode(format: CodeFormat, target: OrmTarget = 'postgres'): Promise<string> {
  const p = active()
  if (!p) return ''
  if (format === 'dbml') return p.source
  if (format === 'project') return JSON.stringify(toProjectFile(p), null, 2)
  if (ORM_FORMATS.has(format)) {
    const [{ exportOrm }, { model, diagnostics }] = await Promise.all([import('@/lib/convert'), parseDbml(p.source)])
    if (!model) {
      const d = diagnostics[0]
      throw new Error(`The schema has an error on line ${d?.line ?? 1}: ${d?.message ?? 'unknown'}`)
    }
    return exportOrm(format as OrmExportFormat, model, target)
  }
  return exportSql(p.source, format as SqlDialect)
}

function codeFileName(format: CodeFormat, base: string): [name: string, type: string] {
  switch (format) {
    case 'dbml':
      return [`${base}.dbml`, 'text/plain']
    case 'project':
      return [`${base}.schemasketch.json`, 'application/json']
    case 'prisma':
      return ['schema.prisma', 'text/plain']
    case 'drizzle':
      return [`${base}.schema.ts`, 'text/typescript']
    case 'typescript':
      return [`${base}.types.ts`, 'text/typescript']
    case 'zod':
      return [`${base}.zod.ts`, 'text/typescript']
    default:
      return [`${base}.${format}.sql`, 'application/sql']
  }
}

export async function downloadCode(format: CodeFormat, target?: OrmTarget) {
  const p = active()
  if (!p) return
  try {
    const text = await generateCode(format, target)
    const [name, type] = codeFileName(format, slug(p.name))
    downloadText(text, name, type)
  } catch (err) {
    toast.error('Could not export', { description: errorText(err) })
  }
}

export async function downloadImage(nodes: Node[], format: 'png' | 'svg') {
  const p = active()
  if (!p) return
  const id = toast.loading(`Rendering ${format.toUpperCase()}…`)
  try {
    const url = await renderDiagram(nodes, format)
    downloadDataUrl(url, `${slug(p.name)}.${format}`)
    toast.success(`Downloaded ${slug(p.name)}.${format}`, { id })
  } catch (err) {
    toast.error('Could not export the image', { id, description: errorText(err) })
  }
}

/* ---------- share ---------- */

export function share() {
  const p = active()
  if (!p) return
  const url = buildShareUrl(p)
  useDialogs.getState().open({ type: 'share', url })
}

export async function copyText(text: string, what = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(what)
  } catch {
    toast.error('Your browser blocked clipboard access', { description: 'Select the text and copy it manually.' })
  }
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
