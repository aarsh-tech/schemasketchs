import { parseModel } from '@/lib/dbml/compile'
import { SAMPLE_DBML } from '@/lib/sample'

/* Shared by the converter tests. Never imported by the app. */

export const parse = (source: string) => {
  const r = parseModel(source)
  if (!r.model) throw new Error(`${r.diagnostics.map((d) => `${d.line}: ${d.message}`).join('\n')}\n\n${source}`)
  return r.model
}

/** Schemas the exporters are checked against, each with the target it suits. */
export const FIXTURES: { name: string; dbml: string; mysql?: boolean }[] = [
  { name: 'sample', dbml: SAMPLE_DBML },
  {
    name: 'postgres features',
    dbml: `Enum auth.role {
  admin
  "read-only"
}
Table auth.users {
  id uuid [pk, default: \`gen_random_uuid()\`]
  handle citext [unique, not null]
  role auth.role [not null, default: 'read-only']
  score "double precision" [default: 0.5]
  tags text[]
  active boolean [not null, default: true]
  seen_at timestamptz(6)
  meta jsonb [note: 'Free-form']
  indexes {
    (handle, role) [unique, name: 'users_handle_role']
    meta [type: gin]
    \`lower(handle)\`
  }
  Note: 'Accounts'
}
Table posts {
  id bigint [pk, increment]
  author_id uuid [not null]
  editor_id uuid
  slug varchar(80) [unique]
  amount numeric(12,4) [default: 0]
  "odd name" text
}
Table pairs {
  a integer
  b integer
  indexes { (a, b) [pk, name: 'pairs_pk'] }
}
Table links {
  id integer [pk]
  a integer [not null]
  b integer [not null]
}
Table log {
  msg text
}
Ref fk_author: posts.author_id > auth.users.id [delete: cascade, update: no action]
Ref: posts.editor_id > auth.users.id [delete: set null]
Ref: links.(a, b) > pairs.(a, b)`,
  },
  {
    name: 'relations',
    dbml: `Table people {
  id integer [pk]
  boss_id integer [ref: > people.id]
  mentor_id integer [ref: > people.id]
}
Table passports {
  id integer [pk]
  person_id integer [unique, not null]
}
Ref: passports.person_id - people.id
Table clubs {
  id integer [pk]
}
Ref: people.id <> clubs.id
Table moves {
  id integer [pk]
  from_id integer [ref: > people.id]
  to_id integer [ref: > people.id]
}`,
  },
  {
    name: 'awkward names',
    dbml: `Table "user accounts" {
  id integer [pk]
  "first name" text
  "1st" integer
  default text
  manager_id integer [ref: > "user accounts".id]
}
Table text {
  id integer [pk]
  index integer
}`,
  },
  {
    name: 'mysql',
    mysql: true,
    dbml: `Project { database_type: 'MySQL' }
Enum status { draft
  live }
Table posts {
  id int [pk, increment]
  title varchar(120) [not null]
  body longtext
  price decimal(8,2) [not null, default: 0]
  views bigint [default: 0]
  state status [default: 'draft']
  published_at datetime(3)
  author_id int [not null, ref: > authors.id]
}
Table authors {
  id int [pk, increment]
  name varchar(80)
}`,
  },
]
