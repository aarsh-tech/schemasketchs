import type { LintRule, Problem } from '../types'
import { tableLabel } from '../util'

/* Reserved words that someone might plausibly use as a table or column name.
   Type names (int, double…) are left out: nobody names a column that. */
const set = (words: string) => new Set(words.split(/\s+/).filter(Boolean))

const POSTGRES = set(`
  all analyse analyze and any array as asc asymmetric authorization binary both case cast check collate collation column
  concurrently constraint create cross current_catalog current_date current_role current_schema current_time
  current_timestamp current_user default deferrable desc distinct do else end except false fetch for foreign freeze from
  full grant group having ilike in initially inner intersect into is isnull join lateral leading left like limit localtime
  localtimestamp natural not notnull null offset on only or order outer overlaps placing primary references returning right
  select session_user similar some symmetric system_user table tablesample then to trailing true union unique user using
  variadic verbose when where window with`)

const MYSQL = set(`
  accessible add all alter analyze and as asc before between both by call cascade case change check collate column condition
  constraint continue convert create cross cube cume_dist current_date current_time current_timestamp current_user cursor
  database databases default delayed delete dense_rank desc describe distinct div drop dual each else elseif empty enclosed
  escaped except exists exit explain false fetch for force foreign from fulltext function generated get grant group grouping
  groups having high_priority if ignore in index infile inner inout insert interval into is iterate join key keys kill lag
  lead leading leave left like limit linear lines load localtime localtimestamp lock long loop low_priority match mod modifies
  natural not null of on optimize option or order out outer outfile over partition precision primary procedure purge range
  rank read reads recursive references regexp release rename repeat replace require resignal restrict return revoke right
  rlike row row_number rows schema schemas select sensitive separator set show signal spatial specific sql ssl starting stored
  system table terminated then to trailing trigger true undo union unique unlock unsigned update usage use using utc_date
  utc_time utc_timestamp values varying virtual when where while window with write xor zerofill`)

const SQL_SERVER = set(`
  add all alter and any as asc authorization backup begin between break browse bulk by cascade case check checkpoint close
  clustered coalesce collate column commit compute constraint contains continue convert create cross current current_date
  current_time current_timestamp current_user cursor database dbcc deallocate declare default delete deny desc disk distinct
  distributed drop dump else end errlvl escape except exec execute exists exit external fetch file fillfactor for foreign
  freetext from full function goto grant group having holdlock identity identitycol if in index inner insert intersect into is
  join key kill left like lineno load merge national nocheck nonclustered not null nullif of off offsets on open option or
  order outer over percent pivot plan precision primary print proc procedure public raiserror read readtext reconfigure
  references replication restore restrict return revert revoke right rollback rowcount rowguidcol rule save schema select
  session_user set setuser shutdown some statistics system_user table tablesample textsize then to top tran transaction
  trigger truncate union unique unpivot update updatetext use user values varying view waitfor when where while with
  writetext`)

const DATABASES: [label: string, words: Set<string>, match: RegExp][] = [
  ['PostgreSQL', POSTGRES, /postgres/i],
  ['MySQL', MYSQL, /mysql|maria/i],
  ['SQL Server', SQL_SERVER, /sql ?server|mssql/i],
]

/** The databases (among the one the schema targets, or all of them) that reserve `name`. */
export function reservedIn(name: string, databaseType: string | null): string[] {
  const n = name.toLowerCase()
  const targeted = DATABASES.filter(([, , re]) => databaseType && re.test(databaseType))
  return (targeted.length ? targeted : DATABASES).filter(([, words]) => words.has(n)).map(([label]) => label)
}

const listed = (dbs: string[]) => (dbs.length > 1 ? `${dbs.slice(0, -1).join(', ')} and ${dbs[dbs.length - 1]}` : dbs[0])

export const reservedWords: LintRule = {
  id: 'reserved-word',
  title: 'Reserved word as a name',
  description: 'Names like order or user are SQL keywords, so every query has to quote them.',
  check(model) {
    const out: Problem[] = []
    for (const t of model.tables) {
      const dbs = reservedIn(t.name, model.databaseType)
      if (dbs.length) {
        out.push({ rule: this.id, tableId: t.id, column: null, message: `Table name ${t.name} is a reserved word in ${listed(dbs)}, so queries must quote it. Rename it, e.g. ${t.name}s.` })
      }
      for (const f of t.fields) {
        const fdbs = reservedIn(f.name, model.databaseType)
        if (fdbs.length) {
          out.push({
            rule: this.id,
            tableId: t.id,
            column: f.name,
            message: `${tableLabel(t)}.${f.name} is a reserved word in ${listed(fdbs)}, so queries must quote it. Rename it, e.g. ${t.name.replace(/s$/, '')}_${f.name}.`,
          })
        }
      }
    }
    return out
  },
}
