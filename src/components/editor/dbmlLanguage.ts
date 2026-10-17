import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import type { StreamParser } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

const BLOCK_KEYWORDS = new Set([
  'table',
  'ref',
  'enum',
  'tablegroup',
  'project',
  'note',
  'indexes',
  'tablepartial',
  'records',
  'checks',
])
const SETTINGS = new Set([
  'pk',
  'primary',
  'key',
  'increment',
  'unique',
  'not',
  'null',
  'default',
  'note',
  'ref',
  'delete',
  'update',
  'cascade',
  'restrict',
  'set',
  'no',
  'action',
  'headercolor',
  'color',
  'name',
  'type',
  'btree',
  'hash',
  'as',
  'database_type',
  'true',
  'false',
])

interface State {
  /** stack of open blocks, e.g. ["table", "indexes"] */
  blocks: string[]
  /** keyword seen before the next "{" on this statement */
  pendingBlock: string | null
  inBracket: number
  inBlockComment: boolean
  inTripleString: boolean
  /** words seen on the current line, used to tell column name from type */
  wordIndex: number
}

const parser: StreamParser<State> = {
  name: 'dbml',
  startState: () => ({
    blocks: [],
    pendingBlock: null,
    inBracket: 0,
    inBlockComment: false,
    inTripleString: false,
    wordIndex: 0,
  }),
  copyState: (s) => ({ ...s, blocks: [...s.blocks] }),

  token(stream, state) {
    if (stream.sol()) state.wordIndex = 0

    if (state.inBlockComment) {
      if (stream.skipTo('*/')) {
        stream.match('*/')
        state.inBlockComment = false
      } else stream.skipToEnd()
      return 'comment'
    }
    if (state.inTripleString) {
      if (stream.skipTo("'''")) {
        stream.match("'''")
        state.inTripleString = false
      } else stream.skipToEnd()
      return 'string'
    }

    if (stream.eatSpace()) return null

    if (stream.match('//')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match('/*')) {
      state.inBlockComment = true
      return 'comment'
    }
    if (stream.match("'''")) {
      state.inTripleString = true
      return 'string'
    }
    if (stream.match(/^'(?:[^'\\]|\\.)*'?/)) return 'string'
    if (stream.match(/^`[^`]*`?/)) return 'string.special'
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) {
      state.wordIndex++
      return state.blocks.at(-1) === 'table' && state.wordIndex === 1 && state.inBracket === 0
        ? 'propertyName'
        : 'variableName'
    }
    if (stream.match(/^#[0-9a-fA-F]{3,8}\b/)) return 'color'
    if (stream.match(/^-?\d+(\.\d+)?/)) return 'number'

    const ch = stream.peek()
    if (ch === '{') {
      stream.next()
      state.blocks.push(state.pendingBlock ?? 'block')
      state.pendingBlock = null
      return 'brace'
    }
    if (ch === '}') {
      stream.next()
      state.blocks.pop()
      return 'brace'
    }
    if (ch === '[') {
      stream.next()
      state.inBracket++
      return 'squareBracket'
    }
    if (ch === ']') {
      stream.next()
      state.inBracket = Math.max(0, state.inBracket - 1)
      return 'squareBracket'
    }
    if (stream.match(/^(<>|<|>|-)/)) return 'operator'
    if (stream.match(/^[(),.:]/)) return 'punctuation'

    const word = stream.match(/^[A-Za-z_][\w]*/) as RegExpMatchArray | null
    if (word) {
      const w = word[0]
      const lower = w.toLowerCase()
      state.wordIndex++

      if (state.inBracket > 0) {
        return SETTINGS.has(lower) ? 'keyword' : 'variableName'
      }
      if (state.wordIndex === 1 && BLOCK_KEYWORDS.has(lower) && (stream.match(/^\s*[\w"{:[]/, false) || stream.eol())) {
        // "Note" inside a table followed by ":" is a setting, still a keyword
        state.pendingBlock = lower
        return 'keyword'
      }
      if (lower === 'as') return 'keyword'

      const block = state.blocks.at(-1)
      if (block === 'table' || block === 'tablepartial') {
        if (state.wordIndex === 1) return 'propertyName'
        if (state.wordIndex === 2) return 'typeName'
      }
      if (block === 'enum') return 'atom'
      if (block === 'project' && state.wordIndex === 1) return 'propertyName'
      if (state.wordIndex === 2 && state.pendingBlock) return 'variableName.definition'
      return 'variableName'
    }

    stream.next()
    return null
  },

  indent(state, textAfter, cx) {
    if (state.inTripleString || state.inBlockComment) return null
    const depth = state.blocks.length - (/^\s*}/.test(textAfter) ? 1 : 0)
    return Math.max(0, depth) * cx.unit
  },

  languageData: {
    indentOnInput: /^\s*}$/,
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
    closeBrackets: { brackets: ['(', '[', '{', "'", '"', '`'] },
  },
}

export const dbmlLanguage = StreamLanguage.define(parser)

export const dbmlHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.keyword, color: 'var(--c-accent)', fontWeight: '600' },
    { tag: t.propertyName, color: 'var(--c-ink)' },
    { tag: t.typeName, color: 'var(--c-ref)' },
    { tag: [t.definition(t.variableName)], color: 'var(--c-ink)', fontWeight: '600' },
    { tag: t.variableName, color: 'var(--c-ink-2)' },
    { tag: t.atom, color: 'var(--c-ink)' },
    { tag: t.string, color: 'var(--c-key)' },
    { tag: t.special(t.string), color: 'var(--c-key)', fontStyle: 'italic' },
    { tag: t.number, color: 'var(--c-key)' },
    { tag: t.color, color: 'var(--c-key)' },
    { tag: [t.comment], color: 'var(--c-ink-3)', fontStyle: 'italic' },
    { tag: t.operator, color: 'var(--c-accent)', fontWeight: '600' },
    { tag: [t.brace, t.squareBracket, t.punctuation], color: 'var(--c-ink-3)' },
  ]),
)
