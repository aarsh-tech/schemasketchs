import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import type { Project, XY } from '@/store/projects'

/* ---------- project file format ---------- */

export interface ProjectFile {
  app: 'schemasketch'
  version: 1
  name: string
  source: string
  positions: Record<string, XY>
}

export function toProjectFile(p: Pick<Project, 'name' | 'source' | 'positions'>): ProjectFile {
  return { app: 'schemasketch', version: 1, name: p.name, source: p.source, positions: p.positions }
}

export function parseProjectFile(text: string): ProjectFile | null {
  try {
    const data = JSON.parse(text) as Partial<ProjectFile>
    if (data?.app !== 'schemasketch' || typeof data.source !== 'string') return null
    return {
      app: 'schemasketch',
      version: 1,
      name: typeof data.name === 'string' ? data.name : 'Imported schema',
      source: data.source,
      positions: cleanPositions(data.positions),
    }
  } catch {
    return null
  }
}

function cleanPositions(raw: unknown): Record<string, XY> {
  const out: Record<string, XY> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const p = v as Partial<XY>
    if (typeof p?.x === 'number' && typeof p?.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)) out[k] = { x: p.x, y: p.y }
  }
  return out
}

export const slug = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'schema'

/* ---------- downloads ---------- */

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const downloadText = (text: string, filename: string, type = 'text/plain') =>
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), filename)

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.click()
}

/* ---------- File System Access API (Chrome / Edge), with fallbacks ---------- */

type FileHandle = FileSystemFileHandle
interface PickerType {
  description: string
  accept: Record<string, string[]>
}
interface FsWindow extends Window {
  showOpenFilePicker?: (o?: { types?: PickerType[]; multiple?: boolean; excludeAcceptAllOption?: boolean }) => Promise<FileHandle[]>
  showSaveFilePicker?: (o?: { suggestedName?: string; types?: PickerType[] }) => Promise<FileHandle>
}
const fsWindow = () => window as FsWindow

export const supportsFileSystemAccess = () => typeof fsWindow().showSaveFilePicker === 'function'

const OPEN_TYPES: PickerType[] = [
  {
    description: 'Schemas (DBML, Schemasketch project, SQL, Prisma, Drizzle)',
    accept: { 'text/plain': ['.dbml', '.sql', '.txt', '.prisma', '.rb', '.ts', '.mts', '.js', '.mjs'], 'application/json': ['.json'] },
  },
]
const SAVE_TYPES: PickerType[] = [
  { description: 'DBML schema', accept: { 'text/plain': ['.dbml'] } },
  { description: 'Schemasketch project (schema + layout)', accept: { 'application/json': ['.json'] } },
]

/** handles live only in memory: they can't be put in localStorage */
const handles = new Map<string, FileHandle>()
export const getLinkedFile = (projectId: string) => handles.get(projectId)?.name ?? null
export const linkFile = (projectId: string, handle: FileHandle) => handles.set(projectId, handle)

export interface OpenedFile {
  name: string
  text: string
  handle?: FileHandle
}

export async function pickFile(): Promise<OpenedFile | null> {
  const w = fsWindow()
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({ types: OPEN_TYPES, multiple: false })
      const file = await handle.getFile()
      return { name: file.name, text: await file.text(), handle }
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return null
      throw err
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.dbml,.sql,.txt,.json,.prisma,.rb,.ts,.mts,.js,.mjs'
    input.onchange = async () => {
      const file = input.files?.[0]
      resolve(file ? { name: file.name, text: await file.text() } : null)
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

function serialise(project: Pick<Project, 'name' | 'source' | 'positions'>, filename: string) {
  return filename.toLowerCase().endsWith('.json')
    ? JSON.stringify(toProjectFile(project), null, 2)
    : project.source
}

async function writeHandle(handle: FileHandle, text: string) {
  const writable = await (handle as FileHandle & { createWritable: () => Promise<FileSystemWritableFileStream> }).createWritable()
  await writable.write(text)
  await writable.close()
}

/**
 * Saves the project. Re-uses the file it was opened from / last saved to when
 * possible. Returns the file name written, or null if the user cancelled.
 */
export async function saveProject(project: Project, opts: { saveAs?: boolean } = {}): Promise<string | null> {
  const w = fsWindow()
  const existing = handles.get(project.id)

  if (existing && !opts.saveAs) {
    await writeHandle(existing, serialise(project, existing.name))
    return existing.name
  }

  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: `${slug(project.name)}.dbml`, types: SAVE_TYPES })
      await writeHandle(handle, serialise(project, handle.name))
      handles.set(project.id, handle)
      return handle.name
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return null
      throw err
    }
  }

  const name = `${slug(project.name)}.dbml`
  downloadText(project.source, name)
  return name
}

/* ---------- share links ---------- */

const SHARE_KEY = 's'

export function buildShareUrl(project: Pick<Project, 'name' | 'source' | 'positions'>): string {
  const rounded: Record<string, XY> = {}
  for (const [k, p] of Object.entries(project.positions)) rounded[k] = { x: Math.round(p.x), y: Math.round(p.y) }
  const payload = compressToEncodedURIComponent(JSON.stringify({ n: project.name, s: project.source, p: rounded }))
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = `${SHARE_KEY}=${payload}`
  return url.toString()
}

export function readShareFromHash(hash: string): ProjectFile | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const raw = params.get(SHARE_KEY)
  if (!raw) return null
  try {
    const json = decompressFromEncodedURIComponent(raw)
    if (!json) return null
    const data = JSON.parse(json) as { n?: string; s?: string; p?: unknown }
    if (typeof data.s !== 'string') return null
    return { app: 'schemasketch', version: 1, name: data.n || 'Shared schema', source: data.s, positions: cleanPositions(data.p) }
  } catch {
    return null
  }
}

export function clearShareHash() {
  history.replaceState(null, '', window.location.pathname + window.location.search)
}

/* ---------- misc ---------- */

export type FileKind = 'dbml' | 'project' | 'sql' | 'prisma' | 'drizzle' | 'database'

const KIND_BY_EXTENSION: Record<string, FileKind> = {
  json: 'project',
  sql: 'sql',
  rb: 'sql',
  dbml: 'dbml',
  prisma: 'prisma',
  ts: 'drizzle',
  mts: 'drizzle',
  cts: 'drizzle',
  js: 'drizzle',
  mjs: 'drizzle',
}

/** What a file holds, from its extension and, failing that, its text. */
export function guessKind(name: string, text: string): FileKind {
  const ext = /\.([a-z]+)$/i.exec(name)?.[1]?.toLowerCase()
  if (ext === 'json' && looksLikeCatalog(text)) return 'database'
  if (ext && KIND_BY_EXTENSION[ext]) return KIND_BY_EXTENSION[ext]
  return guessTextKind(text) ?? 'dbml'
}

/** The JSON the database catalog queries return (see lib/catalog). */
const looksLikeCatalog = (text: string) => /"dialect"\s*:\s*"(postgres|mysql|sqlite|mssql)"/.test(text) && /"columns"\s*:/.test(text)

/** Recognise a pasted catalog result, Prisma, Drizzle or SQL; null when it looks like none of them. */
export function guessTextKind(text: string): Exclude<FileKind, 'project' | 'dbml'> | null {
  if (looksLikeCatalog(text)) return 'database'
  if (/^\s*(model|datasource|generator)\s+\w+\s*\{/m.test(text)) return 'prisma'
  if (/\b(pg|mysql|sqlite)Table(Creator)?\s*\(|from\s+['"]drizzle-orm/.test(text)) return 'drizzle'
  if (/^\s*create\s+(table|type|schema)|ActiveRecord::Schema/im.test(text)) return 'sql'
  return null
}

export const baseName = (filename: string) => filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Imported schema'
