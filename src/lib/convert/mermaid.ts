import type { Cardinality, FieldModel, SchemaModel, TableModel } from '@/lib/dbml/types'
import { relationsOf } from './shared'

/* SchemaModel → a Mermaid erDiagram, which GitHub and GitLab draw inside
   Markdown. Mermaid names and types are stricter than DBML's, so anything
   that doesn't fit is cleaned up and the original kept as a label. */

/** A name Mermaid accepts: a letter or underscore, then letters, digits, _ or -. */
const ident = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^([^A-Za-z_])/, '_$1')

/** An entity name Mermaid accepts, with the original as a display label when they differ. */
function entity(t: TableModel, taken: Map<string, string>): string {
  const original = t.id
  let id = ident(original)
  while ([...taken.values()].includes(id) && taken.get(original) !== id) id = `${id}_`
  taken.set(original, id)
  return id
}

/** Mermaid types are one word; arguments with commas (decimal(10,2)) don't parse, so they go in the comment. */
function mermaidType(type: string): { type: string; dropped: boolean } {
  const plain = type.replace(/"/g, '').trim()
  const m = /^([^(]*)\((.*)\)(.*)$/.exec(plain)
  const keepArgs = !!m && !m[2].includes(',')
  const base = (m ? (keepArgs ? `${m[1]}(${m[2].trim()})${m[3]}` : `${m[1]}${m[3]}`) : plain).replace(/\s+/g, '_').replace(/[^A-Za-z0-9_()[\]-]/g, '_')
  return { type: /^[A-Za-z]/.test(base) ? base : `t_${base}`, dropped: !!m && !keepArgs }
}

const comment = (s: string) => s.replace(/"/g, "'").replace(/\s+/g, ' ').trim()

function attribute(f: FieldModel, fk: boolean): string {
  const { type, dropped } = mermaidType(f.type)
  const name = ident(f.name)
  const keys = [f.pk && 'PK', fk && 'FK', f.unique && !f.pk && 'UK'].filter(Boolean).join(', ')
  const notes = [dropped ? f.type : null, name !== f.name ? f.name : null, f.note].filter(Boolean).map((s) => comment(s!))
  return `        ${type} ${name}${keys ? ` ${keys}` : ''}${notes.length ? ` "${notes.join(' · ')}"` : ''}`
}

// left-hand markers face the first entity, right-hand ones the second
const LEFT: Record<Cardinality, string> = { one: '||', 'zero-one': '|o', many: '}|', 'zero-many': '}o' }
const RIGHT: Record<Cardinality, string> = { one: '||', 'zero-one': 'o|', many: '|{', 'zero-many': 'o{' }

export function toMermaid(model: SchemaModel): string {
  const names = new Map<string, string>()
  const lines = ['erDiagram']
  // the side holding the foreign key, which for one-to-one isn't always the source
  const relations = relationsOf(model)
  const fkColumns = new Map<string, Set<string>>()
  for (const { child } of relations) {
    const set = fkColumns.get(child.tableId) ?? new Set()
    child.fields.forEach((f) => set.add(f))
    fkColumns.set(child.tableId, set)
  }

  for (const t of model.tables) {
    const id = entity(t, names)
    const head = id === t.id ? id : `${id}["${comment(t.id)}"]`
    lines.push(`    ${head} {`)
    for (const f of t.fields) lines.push(attribute(f, !!fkColumns.get(t.id)?.has(f.name)))
    lines.push('    }')
  }

  for (const { ref, child, parent } of relations) {
    const p = names.get(parent.tableId)
    const c = names.get(child.tableId)
    if (!p || !c) continue
    // parent first: "customers ||--o{ orders" reads as "one customer has many orders"
    const label = ref.name ?? child.fields.join(', ')
    lines.push(`    ${p} ${LEFT[parent.cardinality]}--${RIGHT[child.cardinality]} ${c} : "${comment(label)}"`)
  }

  if (model.enums.length) {
    lines.push('', '    %% Mermaid has no enums; their values are listed here')
    for (const e of model.enums) lines.push(`    %% ${e.id}: ${e.values.join(', ')}`)
  }
  return `${lines.join('\n')}\n`
}
