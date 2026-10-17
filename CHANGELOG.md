# Changelog

## Two-way visual editing (#1)
Edits on the canvas now write back into the DBML: a table menu (rename, add column, header colour, delete), a column popover, drag-to-relate with a cardinality picker, Delete on a selected relationship, and an "Add table" button.
All changes go through `src/lib/dbml/edit.ts`, which makes minimal text edits located with the @dbml/parse syntax tree inside the parse worker, and each lands in the editor as one undoable change. Vitest is set up (`pnpm test`, run in CI) with 40 tests for the edit module.

## Version history (#2)
Schemas are snapshotted to IndexedDB (via idb-keyval) after 30 seconds without edits, or saved by hand with a label; up to 100 automatic snapshots are kept per schema and labelled ones are never pruned.
A Version history dialog lists versions with time, label and table-count change, previews the code read-only, and restores both code and layout, saving the current state first and keeping Ctrl+Z working.

## Migration generator (#3)
A Generate migration dialog compares two saved versions, a version and the current schema, or pasted DBML, and shows a change summary with up and down `ALTER` scripts for PostgreSQL or MySQL, flagging data loss with warning comments.
The diff lives in `src/lib/diff/` as pure, lazy-loaded functions (tables with rename detection, columns, keys, indexes, enums, relationships) with 41 Vitest tests. Also fixed: opening one dialog straight from another no longer closes both.

## ORM import and export (#4)
Import a Prisma schema or a Drizzle schema file (pg-core, mysql-core or sqlite-core) into DBML, and export the schema as Prisma, Drizzle, TypeScript interfaces or Zod 4 schemas, from new tabs in the Import and Export dialogs. Dropped `.prisma` and `.ts` files open the right tab, and anything a format can't hold is listed in a comment instead of being dropped silently.
The converters live in `src/lib/convert/` as pure, lazy-loaded functions with 52 new Vitest tests: every fixture round-trips through both ORMs, Prisma output passes Prisma's own validator, and the generated TypeScript compiles against the real `drizzle-orm` and `zod`.
