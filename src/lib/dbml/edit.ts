/**
 * Edits made on the canvas, applied to the DBML text.
 *
 * Every function here is pure: `(source, edit) → newSource`. Changes are made
 * as small text replacements located through the @dbml/parse syntax tree, so
 * the user's comments, spacing and ordering survive. This module pulls in the
 * DBML compiler, so it only runs inside the parse worker (and in tests).
 */
import {
  AttributeNode,
  BlockExpressionNode,
  Compiler,
  DEFAULT_ENTRY,
  ElementDeclarationNode,
  FunctionApplicationNode,
  IdentifierStreamNode,
  InfixExpressionNode,
  ListExpressionNode,
  MemoryProjectLayout,
  PrefixExpressionNode,
  PrimaryExpressionNode,
  SymbolKind,
  TupleExpressionNode,
  UNHANDLED,
  VariableNode,
  addDoubleQuoteIfNeeded,
} from '@dbml/parse'
import type { ProgramNode, SyntaxNode } from '@dbml/parse'
import { toDbmlType } from './values'

/* ---------- edit descriptions ---------- */

export interface TableRef {
  /** null or undefined for the default public schema */
  schema?: string | null
  name: string
}

export interface ColumnRef {
  table: TableRef
  column: string
}

export interface ColumnSpec {
  name: string
  type: string
  pk: boolean
  unique: boolean
  notNull: boolean
  /** already in DBML form: 'text', 42, true, `now()`; null for none */
  defaultValue: string | null
}

/** Changes to a column. Fields left out keep whatever the code says now. */
export type ColumnPatch = Partial<ColumnSpec>

/** `>` many-to-one, `<` one-to-many, `-` one-to-one, `<>` many-to-many */
export type RefOp = '>' | '<' | '-' | '<>'

export interface RefEndpointSpec {
  table: TableRef
  fields: string[]
}

export type SchemaEdit =
  | { type: 'add-table'; name: string; schema?: string | null }
  | { type: 'rename-table'; table: TableRef; name: string }
  | { type: 'delete-table'; table: TableRef }
  | { type: 'set-header-color'; table: TableRef; color: string | null }
  | { type: 'add-column'; table: TableRef; column: ColumnSpec }
  | { type: 'update-column'; table: TableRef; column: string; patch: ColumnPatch }
  | { type: 'delete-column'; table: TableRef; column: string }
  | { type: 'add-ref'; from: ColumnRef; to: ColumnRef; op: RefOp }
  | { type: 'delete-ref'; endpoints: [RefEndpointSpec, RefEndpointSpec] }

/** Thrown when an edit can't be applied. The message is written for the user. */
export class EditError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EditError'
  }
}

/* ---------- entry point ---------- */

export function applyEdit(source: string, edit: SchemaEdit): string {
  const doc = load(source)
  if (doc.errors.length) {
    throw new EditError('The schema has an error, so the diagram can’t be edited right now. Fix the underlined line in the editor first.')
  }
  const next = run(doc, edit)
  if (next === source) return source

  const check = load(next)
  if (check.errors.length) throw new EditError(explain(check.errors[0].diagnostic))
  return next
}

function run(doc: Doc, edit: SchemaEdit): string {
  switch (edit.type) {
    case 'add-table':
      return addTable(doc, edit.name, edit.schema ?? null)
    case 'rename-table':
      return renameTable(doc, edit.table, edit.name)
    case 'delete-table':
      return deleteTable(doc, edit.table)
    case 'set-header-color':
      return setHeaderColor(doc, edit.table, edit.color)
    case 'add-column':
      return addColumn(doc, edit.table, edit.column)
    case 'update-column':
      return updateColumn(doc, edit.table, edit.column, edit.patch)
    case 'delete-column':
      return deleteColumn(doc, edit.table, edit.column)
    case 'add-ref':
      return addRef(doc, edit.from, edit.to, edit.op)
    case 'delete-ref':
      return deleteRef(doc, edit.endpoints)
  }
}

function explain(diagnostic: string): string {
  if (/same endpoints/i.test(diagnostic)) return 'Those columns are already related.'
  if (/duplicate|already (been )?defined|already exists/i.test(diagnostic)) return `That name is already taken. ${diagnostic}`
  return `That change would make the schema invalid: ${diagnostic}`
}

/** Quote a table, column or schema name when DBML needs it. */
const quoteName = (name: string) => addDoubleQuoteIfNeeded(name)

/* ---------- syntax tree helpers ---------- */

interface Doc {
  source: string
  compiler: Compiler
  ast: ProgramNode
  errors: readonly { diagnostic: string }[]
}

function load(source: string): Doc {
  const layout = new MemoryProjectLayout()
  layout.setSource(DEFAULT_ENTRY, source)
  const compiler = new Compiler(layout)
  const errors = compiler.parse.errors(DEFAULT_ENTRY)
  return { source, compiler, ast: compiler.parse.ast(DEFAULT_ENTRY), errors }
}

const DEFAULT_SCHEMA = 'public'
const sameSchema = (a: string | null | undefined, b: string | null | undefined) => (a || DEFAULT_SCHEMA) === (b || DEFAULT_SCHEMA)
const tableLabel = (t: TableRef) => (t.schema && t.schema !== DEFAULT_SCHEMA ? `${t.schema}.${t.name}` : t.name)
const refText = (t: TableRef) => (t.schema && t.schema !== DEFAULT_SCHEMA ? `${quoteName(t.schema)}.${quoteName(t.name)}` : quoteName(t.name))

const kindOf = (el: ElementDeclarationNode) => el.type?.value.toLowerCase() ?? ''

/** `a`, `a.b`, `a.b.c` → ['a', 'b', 'c'] */
function nameParts(node: SyntaxNode | undefined): string[] {
  if (node instanceof PrimaryExpressionNode && node.expression instanceof VariableNode) return [node.expression.variable?.value ?? '']
  if (node instanceof InfixExpressionNode && node.op?.value === '.') return [...nameParts(node.leftExpression), ...nameParts(node.rightExpression)]
  return []
}

function tableElements(doc: Doc): ElementDeclarationNode[] {
  return doc.ast.body.filter((el): el is ElementDeclarationNode => el instanceof ElementDeclarationNode && kindOf(el) === 'table')
}

function tableRefOf(el: ElementDeclarationNode): TableRef {
  const parts = nameParts(el.name)
  return parts.length > 1 ? { schema: parts[0], name: parts[1] } : { schema: null, name: parts[0] ?? '' }
}

function findTable(doc: Doc, ref: TableRef): ElementDeclarationNode {
  const el = tableElements(doc).find((t) => {
    const r = tableRefOf(t)
    return r.name === ref.name && sameSchema(r.schema, ref.schema)
  })
  if (!el) throw new EditError(`Couldn’t find the table ${tableLabel(ref)} in the code.`)
  return el
}

function columnsOf(table: ElementDeclarationNode): FunctionApplicationNode[] {
  return table.body instanceof BlockExpressionNode ? table.body.body.filter((n): n is FunctionApplicationNode => n instanceof FunctionApplicationNode) : []
}

const columnName = (col: FunctionApplicationNode) => nameParts(col.callee)[0] ?? ''

function findColumn(table: ElementDeclarationNode, name: string, ref: TableRef): FunctionApplicationNode {
  const col = columnsOf(table).find((c) => columnName(c) === name)
  if (!col) throw new EditError(`Couldn’t find the column ${tableLabel(ref)}.${name} in the code.`)
  return col
}

const settingsOf = (col: FunctionApplicationNode) => col.args.find((a): a is ListExpressionNode => a instanceof ListExpressionNode)

function attrName(attr: AttributeNode): string {
  if (attr.name instanceof IdentifierStreamNode) return attr.name.identifiers.map((t) => t.value).join(' ').toLowerCase()
  return nameParts(attr.name).join('.').toLowerCase()
}

/** Every place in the code that refers to the symbol a declaration creates. */
function referencesTo(doc: Doc, node: SyntaxNode): SyntaxNode[] {
  const sym = doc.compiler.nodeSymbol(node).getValue()
  if (!sym || sym === UNHANDLED) return []
  return doc.compiler.symbolReferences(sym)
}

/* ---------- text changes ---------- */

interface Change {
  from: number
  to: number
  insert: string
}

function applyChanges(source: string, changes: Change[]): string {
  // drop changes inside a bigger removal (a setting inside a deleted line), then apply back to front
  const sorted = [...changes].sort((a, b) => a.from - b.from || b.to - a.to)
  const kept: Change[] = []
  for (const c of sorted) {
    if (kept.some((k) => k.to > k.from && c.from >= k.from && c.to <= k.to)) continue
    const prev = kept.at(-1)
    if (prev && c.from < prev.to) {
      // two deletions that meet (each taking a blank line) become one
      if (prev.insert === '' && c.insert === '') {
        prev.to = Math.max(prev.to, c.to)
        continue
      }
      throw new EditError('That edit touches overlapping parts of the code. Make it in the editor instead.')
    }
    kept.push({ ...c })
  }
  let out = source
  for (const c of kept.sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to)
  // a deletion at the end of the file shouldn't leave blank lines behind that weren't there before
  if (/\n\s*\n\s*$/.test(out) && !/\n\s*\n\s*$/.test(source)) out = `${out.replace(/\s+$/, '')}\n`
  return out
}

const isSpace = (ch: string | undefined) => ch === ' ' || ch === '\t'
const lineStart = (src: string, pos: number) => src.lastIndexOf('\n', pos - 1) + 1
function lineEnd(src: string, pos: number) {
  const i = src.indexOf('\n', pos)
  return i === -1 ? src.length : i
}
const blankLine = (src: string, start: number) => src.slice(start, lineEnd(src, start)).trim() === ''

/**
 * The range to delete for a node. When the node has its line to itself
 * (apart from indentation and a trailing // comment), the whole line goes,
 * and a blank line is swallowed if the removal would leave two in a row.
 */
function removalRange(src: string, from: number, to: number): { from: number; to: number } {
  let s = from
  while (s > 0 && isSpace(src[s - 1])) s--
  let e = to
  while (e < src.length && isSpace(src[e])) e++
  if (src.startsWith('//', e)) e = lineEnd(src, e)
  const ownsStart = s === 0 || src[s - 1] === '\n'
  const ownsEnd = e >= src.length || src[e] === '\n' || src[e] === '\r'

  if (ownsStart && ownsEnd) {
    if (src[e] === '\r') e++
    if (src[e] === '\n') e++
    const blankBefore = s === 0 || blankLine(src, lineStart(src, s - 1))
    if (blankBefore && e < src.length && blankLine(src, e)) e = Math.min(src.length, lineEnd(src, e) + 1)
    else if (blankBefore && e >= src.length && s > 0) s = lineStart(src, s - 1)
    return { from: s, to: e }
  }
  // shares its line with other code: take the space on one side only
  if (ownsEnd) return { from: s, to }
  return { from, to: e }
}

function remove(src: string, node: SyntaxNode): Change {
  let from = node.start
  // a top-level block takes the // comment lines sitting directly on top of it
  if (node instanceof ElementDeclarationNode && node.parentNode && !(node.parentNode instanceof BlockExpressionNode)) {
    for (let line = lineStart(src, from); line > 0; ) {
      const prev = lineStart(src, line - 1)
      if (!src.slice(prev, line).trim().startsWith('//')) break
      from = prev
      line = prev
    }
  }
  return { ...removalRange(src, from, node.end), insert: '' }
}

/** Indentation of the line a node starts on. */
function indentAt(src: string, pos: number): string {
  const start = lineStart(src, pos)
  return src.slice(start, pos).match(/^[ \t]*/)?.[0] ?? ''
}

/** Rewrite a `[ … ]` settings list to the given attribute texts, dropping it when empty. */
function rewriteList(src: string, list: ListExpressionNode, items: string[]): Change {
  if (items.length === 0) {
    let s = list.start
    while (s > 0 && isSpace(src[s - 1])) s--
    return { from: s, to: list.end, insert: '' }
  }
  return { from: list.start, to: list.end, insert: `[${items.join(', ')}]` }
}

/* ---------- removing things that refer to a deleted table or column ---------- */

/**
 * Collects nodes to delete and turns them into text changes. Settings are
 * grouped per list so a list is rewritten once; a block whose entries are
 * all deleted (indexes, Ref { }, TableGroup) is deleted as a whole.
 */
class Removals {
  private nodes = new Set<SyntaxNode>()
  private attrs = new Map<ListExpressionNode, Set<AttributeNode>>()
  private entries = new Map<ElementDeclarationNode, Set<SyntaxNode>>()

  private doc: Doc

  constructor(doc: Doc) {
    this.doc = doc
  }

  node(n: SyntaxNode) {
    this.nodes.add(n)
  }

  /** One statement of a block element; the element goes too once all its statements have. */
  entry(el: ElementDeclarationNode, line: SyntaxNode) {
    const set = this.entries.get(el) ?? new Set()
    set.add(line)
    this.entries.set(el, set)
  }

  /** Remove whatever statement `ref` (a reference to a table or column) belongs to. */
  referenceSite(ref: SyntaxNode) {
    let child: SyntaxNode = ref
    for (let n = ref.parentNode; n; child = n, n = n.parentNode) {
      if (n instanceof AttributeNode && attrName(n) === 'ref' && n.parentNode instanceof ListExpressionNode) {
        const set = this.attrs.get(n.parentNode) ?? new Set()
        set.add(n)
        this.attrs.set(n.parentNode, set)
        return
      }
      if (n instanceof BlockExpressionNode && n.parentNode instanceof ElementDeclarationNode) {
        // `child` is one statement inside the block: an index, a relation, a group member
        const el = n.parentNode
        const kind = kindOf(el)
        if (kind === 'ref') this.node(el)
        else if (kind === 'indexes' || kind === 'tablegroup') this.entry(el, child)
        return
      }
      if (n instanceof ElementDeclarationNode) {
        // short form, `Ref: a.x > b.y`; anything else (notes, partials, views) is left alone
        if (kindOf(n) === 'ref') this.node(n)
        return
      }
    }
  }

  changes(): Change[] {
    const src = this.doc.source
    const out: Change[] = []
    for (const [el, gone] of this.entries) {
      const body = el.body instanceof BlockExpressionNode ? el.body.body : []
      if (body.every((b) => gone.has(b))) this.nodes.add(el)
      else for (const g of gone) this.nodes.add(g)
    }
    for (const n of this.nodes) out.push(remove(src, n))
    for (const [list, gone] of this.attrs) {
      const items = list.elementList.filter((a) => !gone.has(a)).map((a) => src.slice(a.start, a.end))
      out.push(rewriteList(src, list, items))
    }
    return out
  }
}

/* ---------- tables ---------- */

function addTable(doc: Doc, name: string, schema: string | null): string {
  const clean = name.trim()
  if (!clean) throw new EditError('Give the table a name.')
  const ref = { schema, name: clean }
  if (tableElements(doc).some((t) => sameName(tableRefOf(t), ref))) throw new EditError(`There is already a table called ${tableLabel(ref)}.`)
  const block = `Table ${refText(ref)} {\n  id integer [pk, increment]\n}\n`
  return appendBlock(doc.source, block)
}

const sameName = (a: TableRef, b: TableRef) => a.name.toLowerCase() === b.name.toLowerCase() && sameSchema(a.schema, b.schema)

/** Add a block at the end of the file, separated by one blank line. */
function appendBlock(source: string, block: string, joinWith?: RegExp): string {
  const end = source.replace(/\s+$/, '').length
  if (end === 0) return block
  const lastLine = source.slice(lineStart(source, end), end)
  const sep = joinWith?.test(lastLine) ? '\n' : '\n\n'
  return applyChanges(source, [{ from: end, to: source.length, insert: sep + block }])
}

function renameTable(doc: Doc, table: TableRef, name: string): string {
  const clean = name.trim()
  if (!clean) throw new EditError('A table needs a name.')
  findTable(doc, table)
  if (clean === table.name) return doc.source
  const next = { schema: table.schema, name: clean }
  if (clean.toLowerCase() !== table.name.toLowerCase() && tableElements(doc).some((t) => sameName(tableRefOf(t), next))) {
    throw new EditError(`There is already a table called ${tableLabel(next)}.`)
  }
  const schema = table.schema || undefined
  const result = doc.compiler.renameTable(DEFAULT_ENTRY, { schema, table: table.name }, { schema, table: clean })
  const out = result.get(DEFAULT_ENTRY.absolute)
  if (out === undefined) throw new EditError(`Couldn’t rename ${tableLabel(table)}.`)
  return out
}

function deleteTable(doc: Doc, table: TableRef): string {
  const el = findTable(doc, table)
  const removals = new Removals(doc)
  removals.node(el)
  for (const ref of referencesTo(doc, el)) {
    if (ref.start >= el.start && ref.end <= el.end) continue
    removals.referenceSite(ref)
  }
  return applyChanges(doc.source, removals.changes())
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

function setHeaderColor(doc: Doc, table: TableRef, color: string | null): string {
  if (color !== null && !HEX.test(color)) throw new EditError(`${color} isn’t a colour DBML understands. Use a hex value such as #3B6EA5.`)
  findTable(doc, table)
  return doc.compiler.updateElementSetting(
    DEFAULT_ENTRY,
    { kind: SymbolKind.Table, schema: table.schema || undefined, table: table.name },
    'headercolor',
    color,
  )
}

/* ---------- columns ---------- */

function columnText(spec: ColumnSpec): string {
  const settings = mergeSettings([], spec)
  return `${quoteName(spec.name.trim())} ${toDbmlType(spec.type)}${settings.length ? ` [${settings.join(', ')}]` : ''}`
}

function checkType(type: string) {
  if (!type.trim()) throw new EditError('Give the column a type, such as integer or varchar(255).')
  if (/[\n\r]/.test(type)) throw new EditError('A column type has to fit on one line.')
}

function checkSpec(spec: ColumnSpec) {
  if (!spec.name.trim()) throw new EditError('Give the column a name.')
  checkType(spec.type)
}

function addColumn(doc: Doc, table: TableRef, spec: ColumnSpec): string {
  checkSpec(spec)
  const el = findTable(doc, table)
  const name = spec.name.trim()
  const cols = columnsOf(el)
  if (cols.some((c) => columnName(c) === name)) throw new EditError(`${tableLabel(table)} already has a column called ${name}.`)
  const src = doc.source
  const body = el.body as BlockExpressionNode
  const last = cols.at(-1)

  if (last) {
    // new line after the last column, below its trailing comment if it has one
    let at = last.end
    let e = at
    while (isSpace(src[e])) e++
    if (src.startsWith('//', e)) e = lineEnd(src, e)
    if (e >= src.length || src[e] === '\n' || src[e] === '\r') at = e
    return applyChanges(src, [{ from: at, to: at, insert: `\n${indentAt(src, last.start)}${columnText(spec)}` }])
  }
  const open = body.blockOpenBrace
  if (!open) throw new EditError(`Couldn’t find where ${tableLabel(table)} starts.`)
  const indent = `${indentAt(src, el.start)}  `
  return applyChanges(src, [{ from: open.end, to: open.end, insert: `\n${indent}${columnText(spec)}` }])
}

/**
 * Settings for a column, keeping the ones this editor doesn't manage
 * (increment, note, ref…) exactly as written and in their original order.
 * A flag left out of the patch keeps whatever the code says.
 */
function mergeSettings(existing: { name: string; text: string; value?: string }[], patch: ColumnPatch): string[] {
  const out: string[] = []
  const seen = { pk: false, unique: false, notNull: false, dflt: false }
  const keep = (wanted: boolean | undefined, already: boolean) => (wanted === undefined ? true : wanted && !already)
  for (const s of existing) {
    if (s.name === 'pk' || s.name === 'primary key') {
      if (keep(patch.pk, seen.pk)) out.push(s.text)
      seen.pk = true
    } else if (s.name === 'unique') {
      if (keep(patch.unique, seen.unique)) out.push(s.text)
      seen.unique = true
    } else if (s.name === 'not null') {
      if (keep(patch.notNull, seen.notNull)) out.push(s.text)
      seen.notNull = true
    } else if (s.name === 'null') {
      if (!patch.notNull) out.push(s.text)
    } else if (s.name === 'default') {
      const d = patch.defaultValue
      if (d === undefined) out.push(s.text)
      else if (d !== null && !seen.dflt) out.push(s.value?.trim() === d ? s.text : `default: ${d}`)
      seen.dflt = true
    } else out.push(s.text)
  }
  if (patch.pk && !seen.pk) out.unshift('pk')
  if (patch.unique && !seen.unique) out.push('unique')
  if (patch.notNull && !seen.notNull) out.push('not null')
  if (patch.defaultValue != null && !seen.dflt) out.push(`default: ${patch.defaultValue}`)
  return out
}

/** Compare types the way DBML reads them: quotes and spacing don't matter. */
const sameType = (a: string, b: string) => a.replace(/["\s]/g, '').toLowerCase() === b.replace(/["\s]/g, '').toLowerCase()

function updateColumn(doc: Doc, table: TableRef, column: string, patch: ColumnPatch): string {
  if (patch.name !== undefined && !patch.name.trim()) throw new EditError('A column needs a name.')
  if (patch.type !== undefined) checkType(patch.type)
  const src = doc.source
  const el = findTable(doc, table)
  const col = findColumn(el, column, table)
  const changes: Change[] = []

  const name = patch.name?.trim()
  if (name !== undefined && name !== column) {
    if (columnsOf(el).some((c) => c !== col && columnName(c) === name)) throw new EditError(`${tableLabel(table)} already has a column called ${name}.`)
    const quoted = quoteName(name)
    if (col.callee) changes.push({ from: col.callee.start, to: col.callee.end, insert: quoted })
    for (const ref of referencesTo(doc, col)) changes.push({ from: ref.start, to: ref.end, insert: quoted })
  }

  const typeNode = col.args[0] && !(col.args[0] instanceof ListExpressionNode) ? col.args[0] : undefined
  if (patch.type !== undefined && typeNode) {
    const type = toDbmlType(patch.type)
    if (!sameType(src.slice(typeNode.start, typeNode.end), type)) changes.push({ from: typeNode.start, to: typeNode.end, insert: type })
  }

  const list = settingsOf(col)
  const existing = (list?.elementList ?? []).map((a) => ({
    name: attrName(a),
    text: src.slice(a.start, a.end),
    value: a.value ? src.slice(a.value.start, a.value.end) : undefined,
  }))
  const merged = mergeSettings(existing, patch)
  const before = existing.map((e) => e.text)
  if (merged.join('\n') !== before.join('\n')) {
    if (list) changes.push(rewriteList(src, list, merged))
    else {
      const at = (typeNode ?? col.callee ?? col).end
      changes.push({ from: at, to: at, insert: ` [${merged.join(', ')}]` })
    }
  }
  return applyChanges(src, changes)
}

function deleteColumn(doc: Doc, table: TableRef, column: string): string {
  const el = findTable(doc, table)
  const col = findColumn(el, column, table)
  if (columnsOf(el).length === 1) throw new EditError(`${column} is the only column in ${tableLabel(table)}. A table needs at least one, so delete the table instead.`)
  const removals = new Removals(doc)
  removals.node(col)
  for (const ref of referencesTo(doc, col)) {
    if (ref.start >= col.start && ref.end <= col.end) continue
    removals.referenceSite(ref)
  }
  return applyChanges(doc.source, removals.changes())
}

/* ---------- relationships ---------- */

function addRef(doc: Doc, from: ColumnRef, to: ColumnRef, op: RefOp): string {
  findColumn(findTable(doc, from.table), from.column, from.table)
  findColumn(findTable(doc, to.table), to.column, to.table)
  if (sameName(from.table, to.table) && from.column === to.column) throw new EditError('A column can’t reference itself. Drop onto a different column.')
  const line = `Ref: ${refText(from.table)}.${quoteName(from.column)} ${op} ${refText(to.table)}.${quoteName(to.column)}\n`
  return appendBlock(doc.source, line, /^\s*Ref\b/i)
}

const REL_OPS = new Set(['>', '<', '-', '<>'])

interface FoundRef {
  /** what to delete: an inline `ref:` setting or a whole `Ref` element */
  site: SyntaxNode
  ends: [string, string]
}

function endpointKey(table: TableRef, fields: string[]) {
  const schema = table.schema && table.schema !== DEFAULT_SCHEMA ? table.schema : DEFAULT_SCHEMA
  return `${schema}.${table.name}(${fields.join(',')})`
}

/** Resolve `table.col`, `schema.table.col`, `alias.col` or `table.(a, b)` to an endpoint key. */
function endpointOf(expr: SyntaxNode | undefined, aliases: Map<string, TableRef>): string | null {
  let fields: string[]
  let tableParts: string[]
  if (expr instanceof InfixExpressionNode && expr.op?.value === '.' && expr.rightExpression instanceof TupleExpressionNode) {
    fields = expr.rightExpression.elementList.map((e) => nameParts(e)[0] ?? '')
    tableParts = nameParts(expr.leftExpression)
  } else {
    const parts = nameParts(expr)
    if (parts.length < 2) return null
    fields = [parts[parts.length - 1]]
    tableParts = parts.slice(0, -1)
  }
  const table: TableRef =
    tableParts.length > 1 ? { schema: tableParts[0], name: tableParts[1] } : (aliases.get(tableParts[0]) ?? { schema: null, name: tableParts[0] })
  return endpointKey(table, fields)
}

function findRefs(doc: Doc): FoundRef[] {
  const tables = tableElements(doc)
  const aliases = new Map<string, TableRef>()
  for (const t of tables) {
    const alias = nameParts(t.alias)[0]
    if (alias) aliases.set(alias, tableRefOf(t))
  }
  const found: FoundRef[] = []

  for (const t of tables) {
    const owner = tableRefOf(t)
    for (const col of columnsOf(t)) {
      for (const attr of settingsOf(col)?.elementList ?? []) {
        if (attrName(attr) !== 'ref' || !(attr.value instanceof PrefixExpressionNode)) continue
        const other = endpointOf(attr.value.expression, aliases)
        if (other) found.push({ site: attr, ends: [endpointKey(owner, [columnName(col)]), other] })
      }
    }
  }

  const fromRelation = (fa: FunctionApplicationNode, site: SyntaxNode) => {
    const rel = fa.callee
    if (!(rel instanceof InfixExpressionNode) || !REL_OPS.has(rel.op?.value ?? '')) return
    const a = endpointOf(rel.leftExpression, aliases)
    const b = endpointOf(rel.rightExpression, aliases)
    if (a && b) found.push({ site, ends: [a, b] })
  }
  for (const el of doc.ast.body) {
    if (!(el instanceof ElementDeclarationNode) || kindOf(el) !== 'ref') continue
    if (el.body instanceof FunctionApplicationNode) fromRelation(el.body, el)
    else if (el.body instanceof BlockExpressionNode) {
      // a Ref block holds exactly one relationship
      for (const line of el.body.body) if (line instanceof FunctionApplicationNode) fromRelation(line, el)
    }
  }
  return found
}

function deleteRef(doc: Doc, endpoints: [RefEndpointSpec, RefEndpointSpec]): string {
  const want = endpoints.map((e) => endpointKey(e.table, e.fields)).sort()
  const match = findRefs(doc).find((r) => {
    const have = [...r.ends].sort()
    return have[0] === want[0] && have[1] === want[1]
  })
  if (!match) throw new EditError('Couldn’t find that relationship in the code.')

  const removals = new Removals(doc)
  const { site } = match
  if (site instanceof AttributeNode) removals.referenceSite(site.value ?? site)
  else removals.node(site)
  return applyChanges(doc.source, removals.changes())
}
