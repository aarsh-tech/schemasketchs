import type { FieldModel, RefModel, SchemaModel, TableModel } from '@/lib/dbml/types'

/* Lookups shared by the lint rules. */

export const tableLabel = (t: Pick<TableModel, 'schema' | 'name'>) => (t.schema ? `${t.schema}.${t.name}` : t.name)

export function tableMap(model: SchemaModel): Map<string, TableModel> {
  return new Map(model.tables.map((t) => [t.id, t]))
}

export const fieldOf = (t: TableModel | undefined, name: string): FieldModel | undefined => t?.fields.find((f) => f.name === name)

/** Primary key columns, whether marked on a column or as a composite index. */
export function primaryKey(t: TableModel): string[] {
  const own = t.fields.filter((f) => f.pk).map((f) => f.name)
  if (own.length) return own
  return t.indexes.find((i) => i.pk)?.columns ?? []
}

/** A column can't hold null: not null, or part of the primary key. */
export const isRequired = (t: TableModel, f: FieldModel) => f.notNull || f.pk || primaryKey(t).includes(f.name)

/** Column lists the database keeps an index on: the primary key, unique columns and declared indexes. */
export function indexedColumnLists(t: TableModel): string[][] {
  const lists = [primaryKey(t), ...t.fields.filter((f) => f.unique).map((f) => [f.name]), ...t.indexes.map((i) => i.columns)]
  return lists.filter((l) => l.length > 0)
}

export const isManyToMany = (r: RefModel) => r.source.cardinality.endsWith('many') && r.target.cardinality.endsWith('many')

/**
 * The side of a relationship that holds the foreign key (child) and the side
 * it points at (parent). The many side is the child; for one-to-one, it's the
 * side that isn't the primary key.
 */
export function refSides(r: RefModel, tables: Map<string, TableModel>): { child: RefModel['source']; parent: RefModel['target'] } {
  const many = (e: RefModel['source']) => e.cardinality.endsWith('many')
  if (many(r.target) && !many(r.source)) return { child: r.target, parent: r.source }
  if (!many(r.source) && !many(r.target)) {
    const isPk = (e: RefModel['source']) => {
      const t = tables.get(e.tableId)
      const pk = t ? primaryKey(t) : []
      return pk.length === e.fields.length && pk.every((c) => e.fields.includes(c))
    }
    if (isPk(r.source) && !isPk(r.target)) return { child: r.target, parent: r.source }
  }
  return { child: r.source, parent: r.target }
}

export const columnList = (cols: string[]) => (cols.length === 1 ? cols[0] : `(${cols.join(', ')})`)
