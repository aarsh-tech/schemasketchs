/* A small, forgiving reader for the subset of TypeScript that schema files
   use: `const x = call(...).chain(...)` with objects, arrays, arrow functions
   and template literals. Anything it doesn't understand becomes an opaque
   node instead of an error, so the rest of the file still reads. */

export type JsNode =
  | { t: 'id'; name: string }
  | { t: 'str'; value: string }
  | { t: 'num'; value: number }
  | { t: 'bool'; value: boolean }
  | { t: 'null' }
  /** template literal; `raw` keeps ${…} parts as written */
  | { t: 'tpl'; tag: JsNode | null; raw: string }
  | { t: 'arr'; items: JsNode[] }
  | { t: 'obj'; props: { key: string; value: JsNode }[] }
  | { t: 'member'; object: JsNode; prop: string }
  | { t: 'call'; callee: JsNode; args: JsNode[] }
  | { t: 'arrow'; params: string[]; body: JsNode }
  | { t: 'opaque' }

export interface JsDeclaration {
  name: string
  init: JsNode
  line: number
}

interface Tok {
  k: 'id' | 'str' | 'num' | 'tpl' | 'p'
  v: string
  line: number
}

const PUNCT = ['=>', '...', '?.', '??', '===', '!==', '==', '!=', '&&', '||', '<=', '>=']

function lex(src: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  let line = 1
  const newlines = (s: string) => {
    for (const ch of s) if (ch === '\n') line++
  }
  while (i < src.length) {
    const c = src[i]
    if (c === '\n') {
      line++
      i++
    } else if (/\s/.test(c)) i++
    else if (src.startsWith('//', i)) {
      const end = src.indexOf('\n', i)
      i = end < 0 ? src.length : end
    } else if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2)
      const stop = end < 0 ? src.length : end + 2
      newlines(src.slice(i, stop))
      i = stop
    } else if (c === '"' || c === "'") {
      let j = i + 1
      let s = ''
      while (j < src.length && src[j] !== c && src[j] !== '\n') {
        if (src[j] === '\\' && j + 1 < src.length) {
          const n = src[j + 1]
          s += n === 'n' ? '\n' : n === 't' ? '\t' : n
          j += 2
        } else s += src[j++]
      }
      toks.push({ k: 'str', v: s, line })
      i = j + 1
    } else if (c === '`') {
      let j = i + 1
      let depth = 0
      while (j < src.length && !(src[j] === '`' && depth === 0)) {
        if (src[j] === '\\') j++
        else if (src.startsWith('${', j)) {
          depth++
          j++
        } else if (src[j] === '}' && depth > 0) depth--
        j++
      }
      const raw = src.slice(i + 1, j)
      toks.push({ k: 'tpl', v: raw, line })
      newlines(raw)
      i = j + 1
    } else if (/[0-9]/.test(c)) {
      const m = /^(0x[\da-f]+|\d[\d_]*(\.\d+)?(e[+-]?\d+)?n?)/i.exec(src.slice(i))!
      toks.push({ k: 'num', v: m[0].replace(/_/g, ''), line })
      i += m[0].length
    } else if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i))!
      toks.push({ k: 'id', v: m[0], line })
      i += m[0].length
    } else {
      const p = PUNCT.find((x) => src.startsWith(x, i)) ?? c
      toks.push({ k: 'p', v: p, line })
      i += p.length
    }
  }
  return toks
}

class Bail extends Error {}

const STATEMENT_START = new Set(['const', 'let', 'var', 'export', 'import', 'function', 'class', 'type', 'interface', 'if', 'for', 'while', 'return', 'enum', 'declare'])

class Parser {
  toks: Tok[]
  i = 0
  constructor(toks: Tok[]) {
    this.toks = toks
  }
  peek(n = 0): Tok | undefined {
    return this.toks[this.i + n]
  }
  is(v: string, n = 0) {
    const t = this.peek(n)
    return !!t && (t.k === 'p' || t.k === 'id') && t.v === v
  }
  eat(v: string) {
    if (!this.is(v)) return false
    this.i++
    return true
  }
  expect(v: string) {
    if (!this.eat(v)) throw new Bail()
  }

  /** index of the bracket matching the one at `from` */
  matching(from: number): number {
    const open = this.toks[from].v
    const close = open === '(' ? ')' : open === '[' ? ']' : open === '{' ? '}' : '>'
    let depth = 0
    for (let j = from; j < this.toks.length; j++) {
      const t = this.toks[j]
      if (t.k !== 'p') continue
      if (t.v === open) depth++
      else if (t.v === close && --depth === 0) return j
      else if (open === '<' && t.v === ';') return -1
    }
    return -1
  }

  /** a statement keyword at the start of a line: where a semicolon-free file starts its next statement */
  newStatement(): boolean {
    const t = this.peek()
    const prev = this.peek(-1)
    return !!t && !!prev && t.k === 'id' && STATEMENT_START.has(t.v) && t.line > prev.line
  }

  /** skip to the next `,` `)` `]` `}` or `;` at this depth */
  skipExpression() {
    while (this.peek()) {
      const t = this.peek()!
      if (t.k === 'p' && [',', ')', ']', '}', ';'].includes(t.v)) return
      if (this.newStatement()) return
      if (t.k === 'p' && ['(', '[', '{'].includes(t.v)) {
        const end = this.matching(this.i)
        if (end < 0) {
          this.i = this.toks.length
          return
        }
        this.i = end + 1
      } else this.i++
    }
  }

  /** skip a type annotation: up to `=`, `=>`, `,`, `)` or `;` at depth 0 */
  skipType(stop: string[] = ['=', '=>', ',', ')', ';', '}', ']']) {
    while (this.peek()) {
      const t = this.peek()!
      if (t.k === 'p' && stop.includes(t.v)) return
      if (this.newStatement()) return
      if (t.k === 'p' && ['(', '[', '{', '<'].includes(t.v)) {
        const end = this.matching(this.i)
        this.i = end < 0 ? this.i + 1 : end + 1
      } else this.i++
    }
  }

  /** an expression, or an opaque node if it isn't one we understand */
  expr(): JsNode {
    const start = this.i
    try {
      const node = this.postfix(this.primary())
      // operators we don't model: treat the whole expression as opaque
      const t = this.peek()
      if (t && t.k === 'p' && ![',', ')', ']', '}', ';', ':'].includes(t.v)) {
        this.skipExpression()
        return { t: 'opaque' }
      }
      if (t && t.k === 'id' && (t.v === 'as' || t.v === 'satisfies')) {
        this.i++
        this.skipType([',', ')', ']', '}', ';'])
      }
      return node
    } catch (err) {
      if (!(err instanceof Bail)) throw err
      this.i = start
      this.skipExpression()
      return { t: 'opaque' }
    }
  }

  primary(): JsNode {
    const t = this.peek()
    if (!t) throw new Bail()
    if (t.k === 'str') {
      this.i++
      return { t: 'str', value: t.v }
    }
    if (t.k === 'num') {
      this.i++
      return { t: 'num', value: Number(t.v.replace(/n$/, '')) }
    }
    if (t.k === 'tpl') {
      this.i++
      return { t: 'tpl', tag: null, raw: t.v }
    }
    if (t.k === 'p') {
      if (t.v === '-' && this.peek(1)?.k === 'num') {
        this.i += 2
        return { t: 'num', value: -Number(this.peek(-1)!.v) }
      }
      if (t.v === '[') return this.array()
      if (t.v === '{') return this.object()
      if (t.v === '(') return this.parenOrArrow()
      throw new Bail()
    }
    // identifiers and keywords
    if (t.v === 'true' || t.v === 'false') {
      this.i++
      return { t: 'bool', value: t.v === 'true' }
    }
    if (t.v === 'null' || t.v === 'undefined') {
      this.i++
      return { t: 'null' }
    }
    if (t.v === 'new') {
      this.i++
      return this.postfix(this.primary())
    }
    if (t.v === 'async' && (this.is('(', 1) || this.peek(1)?.k === 'id')) {
      this.i++
      return this.primary()
    }
    if (t.v === 'function') throw new Bail()
    if (this.is('=>', 1)) {
      this.i += 2
      return { t: 'arrow', params: [t.v], body: this.arrowBody() }
    }
    this.i++
    return { t: 'id', name: t.v }
  }

  postfix(node: JsNode): JsNode {
    for (;;) {
      if (this.is('.') || this.is('?.')) {
        this.i++
        const name = this.peek()
        if (name?.k === 'id') {
          this.i++
          node = { t: 'member', object: node, prop: name.v }
        } else if (this.is('(')) continue // optional call: a?.()
        else throw new Bail()
      } else if (this.is('!')) this.i++ // non-null assertion
      else if (this.is('<')) {
        // type arguments before a call: x.$type<Foo>()
        const end = this.matching(this.i)
        if (end < 0 || !(this.toks[end + 1]?.k === 'p' && this.toks[end + 1].v === '(')) return node
        this.i = end + 1
      } else if (this.is('(')) {
        this.i++
        node = { t: 'call', callee: node, args: this.list(')') }
      } else if (this.peek()?.k === 'tpl') {
        node = { t: 'tpl', tag: node, raw: this.peek()!.v }
        this.i++
      } else if (this.is('[')) {
        // element access: x['key']
        this.i++
        const key = this.expr()
        this.expect(']')
        node = key.t === 'str' ? { t: 'member', object: node, prop: key.value } : { t: 'opaque' }
      } else return node
    }
  }

  /** comma-separated expressions up to `close` (consumed) */
  list(close: string): JsNode[] {
    const items: JsNode[] = []
    while (this.peek() && !this.is(close)) {
      if (this.eat('...')) {
        this.expr()
        items.push({ t: 'opaque' })
      } else items.push(this.expr())
      if (!this.eat(',') && !this.is(close)) throw new Bail()
    }
    this.expect(close)
    return items
  }

  array(): JsNode {
    this.expect('[')
    return { t: 'arr', items: this.list(']') }
  }

  object(): JsNode {
    this.expect('{')
    const props: { key: string; value: JsNode }[] = []
    while (this.peek() && !this.is('}')) {
      const t = this.peek()!
      if (this.eat('...')) this.expr()
      else if (t.k === 'p' && t.v === '[') {
        // computed key
        const end = this.matching(this.i)
        if (end < 0) throw new Bail()
        this.i = end + 1
        this.expect(':')
        this.expr()
      } else if (t.k === 'id' || t.k === 'str' || t.k === 'num') {
        this.i++
        const key = t.v
        if (this.eat(':')) props.push({ key, value: this.expr() })
        else if (this.is('(') || this.is('<')) {
          // method shorthand: key(params) { body }
          if (this.is('<')) this.i = this.matching(this.i) + 1
          const params = this.params()
          if (this.eat(':')) this.skipType(['{'])
          props.push({ key, value: { t: 'arrow', params, body: this.block() } })
        } else props.push({ key, value: { t: 'id', name: key } })
      } else throw new Bail()
      if (!this.eat(',') && !this.is('}')) throw new Bail()
    }
    this.expect('}')
    return { t: 'obj', props }
  }

  /** parameter names of `(a, b: T, { c })`; consumes the parentheses */
  params(): string[] {
    const end = this.matching(this.i)
    if (end < 0) throw new Bail()
    const names: string[] = []
    let depth = 0
    for (let j = this.i + 1; j < end; j++) {
      const t = this.toks[j]
      if (t.k === 'p' && ['(', '[', '{', '<'].includes(t.v)) depth++
      else if (t.k === 'p' && [')', ']', '}', '>'].includes(t.v)) depth--
      else if (depth === 0 && t.k === 'id' && (j === this.i + 1 || this.toks[j - 1].v === ',')) names.push(t.v)
    }
    this.i = end + 1
    return names
  }

  parenOrArrow(): JsNode {
    const end = this.matching(this.i)
    if (end < 0) throw new Bail()
    const after = this.toks[end + 1]
    if (after?.k === 'p' && (after.v === '=>' || after.v === ':')) {
      const params = this.params()
      if (this.eat(':')) this.skipType(['=>'])
      this.expect('=>')
      return { t: 'arrow', params, body: this.arrowBody() }
    }
    this.i++
    const inner = this.expr()
    this.expect(')')
    return inner
  }

  arrowBody(): JsNode {
    return this.is('{') ? this.block() : this.expr()
  }

  /** a `{ … }` function body; its value is the first top-level `return` */
  block(): JsNode {
    const end = this.matching(this.i)
    if (end < 0) throw new Bail()
    let depth = 0
    for (let j = this.i + 1; j < end; j++) {
      const t = this.toks[j]
      if (t.k === 'p' && ['(', '[', '{'].includes(t.v)) depth++
      else if (t.k === 'p' && [')', ']', '}'].includes(t.v)) depth--
      else if (depth === 0 && t.k === 'id' && t.v === 'return') {
        const sub = new Parser(this.toks.slice(j + 1, end))
        const value = sub.expr()
        this.i = end + 1
        return value
      }
    }
    this.i = end + 1
    return { t: 'opaque' }
  }
}

/** Every top-level `const|let|var name = …` in the file. */
export function readDeclarations(src: string): JsDeclaration[] {
  const p = new Parser(lex(src))
  const out: JsDeclaration[] = []
  let depth = 0
  while (p.peek()) {
    const t = p.peek()!
    if (t.k === 'p' && ['(', '[', '{'].includes(t.v)) depth++
    else if (t.k === 'p' && [')', ']', '}'].includes(t.v)) depth = Math.max(0, depth - 1)
    if (depth === 0 && t.k === 'id' && ['const', 'let', 'var'].includes(t.v) && p.peek(1)?.k === 'id') {
      const name = p.peek(1)!.v
      p.i += 2
      if (p.eat(':')) p.skipType(['=', ';'])
      if (p.eat('=')) {
        out.push({ name, init: p.expr(), line: t.line })
        continue
      }
    }
    p.i++
  }
  return out
}

/* ---------- helpers for reading the tree ---------- */

export interface ChainCall {
  name: string
  args: JsNode[]
}

/**
 * Flatten `a.b(1).c(2)` into its head and the calls after it:
 * head = `a.b(1)` as { object: a, name: 'b', args: [1] }, calls = [{ name: 'c', args: [2] }].
 */
export function flattenChain(node: JsNode): { head: { object: JsNode | null; name: string; args: JsNode[] } | null; calls: ChainCall[] } {
  const calls: ChainCall[] = []
  let n = node
  while (n.t === 'call' && n.callee.t === 'member') {
    const inner = n.callee.object
    // stop at the first call whose receiver isn't itself a call: that's the head
    if (inner.t !== 'call') return { head: { object: inner, name: n.callee.prop, args: n.args }, calls: calls.reverse() }
    calls.push({ name: n.callee.prop, args: n.args })
    n = inner
  }
  if (n.t === 'call' && n.callee.t === 'id') return { head: { object: null, name: n.callee.name, args: n.args }, calls: calls.reverse() }
  return { head: null, calls: calls.reverse() }
}

export const strValue = (n: JsNode | undefined): string | null => (n?.t === 'str' ? n.value : n?.t === 'tpl' && !n.tag && !n.raw.includes('${') ? n.raw : null)

export const prop = (n: JsNode | undefined, key: string): JsNode | undefined => (n?.t === 'obj' ? n.props.find((p) => p.key === key)?.value : undefined)
