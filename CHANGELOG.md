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

## Import from a live database (#5)
A new Database tab in the Import dialog gives a read-only catalog query for PostgreSQL, MySQL, SQLite or SQL Server. Run it in your own client and paste back (or drop) the JSON it returns: tables, columns, types, defaults, keys, indexes, enums and comments become DBML. The app never connects to a database, and the dialog says so.
The queries and the JSON reader live in `src/lib/catalog/` (pure, lazy-loaded) with 13 Vitest tests that run the real PostgreSQL query in PGlite and the real SQLite query in `node:sqlite`.

## Schema linting (#6)
Seven checks run after every parse: foreign key without an index (skipped for MySQL, which adds them), table without a primary key, nullability that contradicts the relationship (with DBML's `>?` for optional ones, and `set null` on a not null column), relationships between different types, reserved words, mixed naming styles and tables over 40 columns.
Findings show as yellow squiggles in the editor, a badge on the table that jumps to the code, and a Problems list in the status bar whose Rules tab switches checks off per schema (stored on the project; persist version 2). Rules live in `src/lib/lint/rules/`, one per file, with 16 Vitest tests.

## Multiple views (#7)
Tabs above the canvas switch between the full diagram and named views, each a subset of tables with its own layout; the DBML stays the single source. Views are made from the + tab or the canvas selection, edited with a filterable table picker, grown with "Show related tables", and changed from a table's right-click menu. They follow table renames, persist with the project (persist version 3) and travel in project files and share links.
Also fixed: auto-layout after switching projects or views could run before tables were measured and overlap them. `src/lib/views.ts` has 7 Vitest tests.

## Search and focus mode (#8)
A command palette (Ctrl/⌘+K, or the search button in the top bar) fuzzy-finds tables and columns, centring the canvas on them and selecting them in the code, and runs every app command: exports, layout, views, version history, theme and more.
Focus mode, from a table's menu or the palette, shows one table and its neighbours up to 1 to 3 relationships away, dimming or hiding the rest, with a bar to change depth and Esc to leave. `src/lib/search.ts` holds the matching and neighbourhood walk, with 9 Vitest tests.

## Canvas undo/redo and more exports (#9)
Table moves and auto-layouts can be undone and redone with Ctrl/⌘+Z and Ctrl/⌘+Shift+Z on the canvas or the toolbar arrows, per schema and view and separate from the editor's undo.
New exports: PDF fitted to an A4 page in the light theme (written by a small built-in PDF writer, no library), a Mermaid `erDiagram`, and a Markdown data dictionary with the diagram embedded. 12 Vitest tests, including Mermaid's own parser accepting every fixture.

## Installable offline app (#10)
Schemasketch is now a PWA (vite-plugin-pwa): a web app manifest with new icons, and a service worker that precaches the app shell, fonts, the parse worker and the lazy chunks. The 15 MB SQL import worker isn't precached; it's cached the first time it's used.
After the first visit the app opens offline, and when a new version is deployed an "Update available" toast offers to reload. Checked against a production preview: an offline reload renders the diagram, and a rebuilt deploy brings up the toast.
