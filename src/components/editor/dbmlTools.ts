import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import type { Diagnostic } from '@codemirror/lint'
import type { Text } from '@codemirror/state'
import type { ParseDiagnostic, SchemaModel } from '@/lib/dbml/types'
import type { Problem } from '@/lib/lint'
import { tableKey } from '@/lib/dbml/normalize'

/* ---------- table detection ---------- */

const TABLE_HEADER = /^\s*Table\s+((?:"[^"]+"|[\w]+)(?:\.(?:"[^"]+"|[\w]+))?)/i

function splitName(raw: string): { schema: string | null; name: string } {
  const parts = raw.match(/"[^"]+"|[\w]+/g) ?? [raw]
  const clean = parts.map((p) => p.replace(/^"|"$/g, ''))
  return clean.length > 1 ? { schema: clean[0], name: clean[1] } : { schema: null, name: clean[0] }
}

/** Returns the table key whose `Table … { … }` block contains `pos`, if any. */
export function tableAtPosition(doc: Text, pos: number): string | null {
  const cursorLine = doc.lineAt(pos).number
  const stack: (string | null)[] = []
  let inBlockComment = false

  for (let i = 1; i <= cursorLine; i++) {
    let text = doc.line(i).text
    if (i === cursorLine) text = text.slice(0, pos - doc.line(i).from)
    // strip comments and strings so braces inside them don't count
    if (inBlockComment) {
      const end = text.indexOf('*/')
      if (end === -1) continue
      text = text.slice(end + 2)
      inBlockComment = false
    }
    text = text.replace(/\/\*.*?\*\//g, '')
    const bc = text.indexOf('/*')
    if (bc !== -1) {
      text = text.slice(0, bc)
      inBlockComment = true
    }
    text = text.replace(/\/\/.*$/, '').replace(/'(?:[^'\\]|\\.)*'|`[^`]*`/g, '')

    const header = text.match(TABLE_HEADER)
    for (const ch of text) {
      if (ch === '{') {
        if (header && stack.length === 0) {
          const { schema, name } = splitName(header[1])
          stack.push(tableKey(schema, name))
        } else stack.push(null)
      } else if (ch === '}') stack.pop()
    }
  }
  return stack.find((x) => x !== null) ?? null
}

/** Finds the line where a table is declared. */
export function findTableLine(doc: Text, tableId: string): { from: number; to: number } | null {
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const m = line.text.match(TABLE_HEADER)
    if (!m) continue
    const { schema, name } = splitName(m[1])
    if (tableKey(schema, name) === tableId) {
      const start = line.from + line.text.indexOf(m[1])
      return { from: start, to: start + m[1].length }
    }
  }
  return null
}

const COLUMN_NAME = /^\s*("(?:[^"\\]|\\.)+"|[\w]+)/

/** Finds a column's name inside its table's block, falling back to the table name. */
export function findColumnRange(doc: Text, tableId: string, column: string | null): { from: number; to: number } | null {
  const header = findTableLine(doc, tableId)
  if (!header || column === null) return header
  let depth = 0
  for (let i = doc.lineAt(header.from).number; i <= doc.lines; i++) {
    const line = doc.line(i)
    const text = line.text.replace(/\/\/.*$/, '').replace(/'(?:[^'\\]|\\.)*'|`[^`]*`/g, "''")
    const startDepth = depth
    for (const ch of text) {
      if (ch === '{') depth++
      else if (ch === '}') depth--
    }
    if (startDepth === 1) {
      const m = COLUMN_NAME.exec(line.text)
      const name = m?.[1].replace(/^"|"$/g, '')
      if (m && name === column) {
        const start = line.from + line.text.indexOf(m[1])
        return { from: start, to: start + m[1].length }
      }
    }
    if (depth <= 0 && i > doc.lineAt(header.from).number) break
  }
  return header
}

/* ---------- diagnostics ---------- */

export function toCmDiagnostics(doc: Text, diags: ParseDiagnostic[]): Diagnostic[] {
  return diags.map((d) => {
    const lineNo = Math.min(Math.max(d.line, 1), doc.lines)
    const line = doc.line(lineNo)
    const from = Math.min(line.from + Math.max(d.column - 1, 0), line.to)
    const endLineNo = Math.min(Math.max(d.endLine, lineNo), doc.lines)
    const endLine = doc.line(endLineNo)
    let to = Math.min(endLine.from + Math.max(d.endColumn - 1, 0), endLine.to)
    if (to <= from) to = Math.min(from + 1, doc.length)
    return { from, to, severity: 'error', message: d.message }
  })
}

/** Lint findings as editor warnings, underlining the column or table they're about. */
export function problemsToCm(doc: Text, problems: Problem[]): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const p of problems) {
    const range = findColumnRange(doc, p.tableId, p.column)
    if (range) out.push({ ...range, severity: 'warning', message: p.message, source: 'Schema check' })
  }
  return out.sort((a, b) => a.from - b.from)
}

/* ---------- autocomplete ---------- */

const KEYWORDS = ['Table', 'Ref', 'Enum', 'TableGroup', 'Project', 'Note', 'indexes', 'TablePartial']
const SETTINGS = [
  'pk',
  'primary key',
  'increment',
  'unique',
  'not null',
  'null',
  'default: ',
  'note: ',
  'ref: > ',
  'ref: < ',
  'ref: - ',
  'ref: <> ',
  'delete: cascade',
  'update: cascade',
  'headercolor: ',
  'color: ',
]
export const COLUMN_TYPES = [
  'integer',
  'bigint',
  'smallint',
  'serial',
  'bigserial',
  'decimal(10,2)',
  'numeric',
  'float',
  'double',
  'boolean',
  'varchar(255)',
  'char',
  'text',
  'uuid',
  'date',
  'time',
  'timestamp',
  'timestamptz',
  'json',
  'jsonb',
  'bytea',
]

export function dbmlCompletions(getModel: () => SchemaModel) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const word = ctx.matchBefore(/[\w.]*/)
    if (!word || (word.from === word.to && !ctx.explicit)) return null

    const line = ctx.state.doc.lineAt(ctx.pos)
    const before = line.text.slice(0, ctx.pos - line.from)
    const inBracket = before.lastIndexOf('[') > before.lastIndexOf(']')
    const model = getModel()

    const tableRefs = model.tables.flatMap((t) => [
      { label: t.id, type: 'class', detail: 'table', boost: 2 },
      ...t.fields.map((f) => ({ label: `${t.id}.${f.name}`, type: 'property', detail: f.type })),
    ])
    const enums = model.enums.map((e) => ({ label: e.id, type: 'enum', detail: 'enum' }))

    // after "ref:" or on a "Ref:" line → table/column names
    if (/ref\s*:\s*[<>-]*\s*[\w.]*$/i.test(before) || /^\s*Ref\b/i.test(before)) {
      return { from: word.from, options: tableRefs, validFor: /^[\w.]*$/ }
    }
    if (inBracket) {
      return { from: word.from, options: SETTINGS.map((s) => ({ label: s, type: 'keyword' })), validFor: /^[\w ]*$/ }
    }

    const tokensBefore = before.trim().split(/\s+/).filter(Boolean)
    const insideBlock = tableAtPosition(ctx.state.doc, ctx.pos) !== null
    if (insideBlock && tokensBefore.length === 1 && /\s$/.test(before) === false && word.from > line.from) {
      // still typing the column name – no suggestions
      return null
    }
    if (insideBlock && tokensBefore.length >= 1 && before.match(/^\s*[\w"]+\s+[\w.]*$/)) {
      return {
        from: word.from,
        options: [...COLUMN_TYPES.map((t) => ({ label: t, type: 'type' })), ...enums],
        validFor: /^[\w.()]*$/,
      }
    }
    if (!insideBlock && tokensBefore.length <= 1) {
      return { from: word.from, options: KEYWORDS.map((k) => ({ label: k, type: 'keyword' })), validFor: /^\w*$/ }
    }
    return null
  }
}
