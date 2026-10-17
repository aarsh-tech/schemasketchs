import type { Node } from '@xyflow/react'
import { toast } from 'sonner'
import { editorText, replaceEditorText, undoInEditor } from '@/components/editor/bridge'
import { editDbml, exportSql, importToDbml } from '@/lib/dbml/client'
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
import { useDialogs } from '@/store/dialogs'
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
  if (kind === 'sql') {
    useDialogs.getState().open({ type: 'import-sql', text, fileName: name })
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

/* ---------- import SQL ---------- */

export async function importSql(sql: string, dialect: ImportDialect, mode: 'new' | 'replace', name?: string) {
  const dbml = await importToDbml(sql, dialect)
  if (mode === 'replace') replaceActive({ source: dbml })
  else useProjects.getState().createProject({ name: name ?? 'Imported schema', source: dbml })
  toast.success(mode === 'replace' ? 'Replaced the schema with the imported SQL' : 'Imported SQL into a new schema')
}

/* ---------- export ---------- */


export async function generateCode(format: SqlDialect | 'dbml' | 'project'): Promise<string> {
  const p = active()
  if (!p) return ''
  if (format === 'dbml') return p.source
  if (format === 'project') return JSON.stringify(toProjectFile(p), null, 2)
  return exportSql(p.source, format)
}

export async function downloadCode(format: SqlDialect | 'dbml' | 'project') {
  const p = active()
  if (!p) return
  try {
    const text = await generateCode(format)
    const base = slug(p.name)
    if (format === 'dbml') downloadText(text, `${base}.dbml`)
    else if (format === 'project') downloadText(text, `${base}.schemasketch.json`, 'application/json')
    else downloadText(text, `${base}.${format}.sql`, 'application/sql')
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
