# Roadmap

Build these in order, one per branch or PR. Each item lists what "done" means. Tick the box when an item ships.

The aim: **the schema tool that fits a developer's real codebase**, with schema as code, visual editing, migrations and ORM round-trips, and still no backend.

---

## Phase 1: what sets it apart

### - [x] 1. Two-way visual editing

Today the diagram only reflects the code. Make edits on the canvas write back into the DBML text.

- Right-click a table for a menu: rename table, add column, delete table, change header color.
- Click a column to edit its name, type, pk, unique, not null and default in a small popover.
- Drag from one column to another to create a relationship (`Ref: a.x > b.y`). Pick the cardinality after dropping.
- Select an edge and press Delete to remove the relationship.
- Add a table from a toolbar button. It's placed at the centre of the view.
- All edits go through one module (`src/lib/dbml/edit.ts`) of pure functions `(source, edit) → newSource` that make minimal text changes and keep the user's comments and formatting. Look at `@dbml/core`'s `renameTable` / `updateElementSetting` transforms first.
- Unit tests for `edit.ts` with Vitest (add it as a dev dependency).
- Done when every edit updates the code, the editor shows the change, and undo in the editor (Ctrl+Z) reverses it.

### - [x] 2. Version history

- Take an automatic snapshot of a project's source after editing stops for 30 seconds, plus a manual "Save version" with an optional label.
- A history panel lists versions with time, label and table-count change. You can preview a version read-only and restore it.
- Store snapshots in IndexedDB (use `idb-keyval`), not localStorage. Cap automatic snapshots at 100 per project and never delete labelled ones.
- Done when restoring a version brings back both the code and the layout.

### - [x] 3. Migration generator

- "Generate migration": pick two versions (from #2, or the current schema against a version, or against pasted DBML).
- Diff the two SchemaModels: added, removed and renamed tables; added, removed and changed columns (type, null, default, unique); added and removed refs, indexes and enums.
- Output `ALTER` SQL for PostgreSQL and MySQL, with an "up" and a "down" script. Flag destructive changes (dropping a column or table) with a warning comment.
- Show a readable change summary above the SQL. Copy and download buttons.
- Put the diff logic in `src/lib/diff/` as pure functions, with Vitest tests.

### - [x] 4. ORM import and export

- Import: Prisma schema (`schema.prisma`) to DBML. Then Drizzle (pg-core / mysql-core table definitions).
- Export: Prisma schema, Drizzle schema, TypeScript interfaces, Zod schemas.
- Add these to the Import and Export dialogs as tabs, with format detection when a file is dropped.
- Converters live in `src/lib/convert/`, are lazy-loaded, and have round-trip tests.

### - [x] 5. Import from a live database (no backend)

- Dialog: choose PostgreSQL, MySQL, SQLite or SQL Server, and get a ready-made catalog query to copy (reads tables, columns, PKs, FKs, indexes and enums as one JSON result).
- The user runs it in their own client and pastes the JSON back. Schemasketch builds the DBML from it.
- Nothing ever connects to a database from the app. Say so in the dialog.

### - [x] 6. Schema linting

- Rules: FK column without an index; table without a primary key; mixed naming styles (`userId` vs `user_id`); reserved words as names; a ref between columns of different types; nullable FK where the relationship says required; very wide tables (over 40 columns).
- Show warnings as yellow squiggles in the editor and a small badge on affected tables. A "Problems" list sits in the status bar.
- Each rule can be turned off. Settings are stored per project.
- Rules live in `src/lib/lint/`, one file per rule, with tests.

---

## Phase 2: catching up with the competition

### - [x] 7. Multiple views of one schema

- A view is a named subset of tables (e.g. "Auth", "Billing") with its own layout. The full schema stays one source.
- Tabs above the canvas switch views. A table can appear in several views. "Show related tables" adds neighbours.

### - [x] 8. Search and focus mode

- Ctrl/⌘+K command palette: jump to a table or column, and run any command (export, layout, theme…).
- Focus mode: show only the selected table and its neighbours up to N relationships away (1 to 3), and dim or hide the rest.

### - [ ] 9. Undo/redo for the canvas, plus more exports

- Undo and redo for table moves and auto-layout (Ctrl+Z on the canvas, separate from editor undo).
- Export PDF (fit to page, light theme), Mermaid `erDiagram` (renders in GitHub READMEs) and a Markdown data dictionary (each table, its columns, types, notes and relations).

### - [ ] 10. Installable offline app (PWA)

- Use `vite-plugin-pwa`: manifest, icons, and caching of the app shell and fonts. Don't precache the big SQL worker; fetch it the first time it's needed.
- Show an "Update available, reload" toast when a new version is deployed.

---

## Phase 3: ambitious extras

### - [ ] 11. Live collaboration without a server

- Yjs document for the DBML text and positions, synced peer-to-peer with `y-webrtc` and the editor bound with `y-codemirror.next`.
- "Start live session" creates a room link. Show collaborators' cursors and selected tables. Leaving the session keeps a local copy.
- Note in the UI that public WebRTC signalling servers only see the connection setup, never the data.

### - [ ] 12. AI assistant (bring your own key)

> **Skipped for now**, at the project owner's request. Don't build this item until they ask for it; go straight from #11 to #13.

- Settings: paste an Anthropic or OpenAI API key. It's stored only in this browser, and the UI says so.
- Panel with prompts like "Add a reviews feature", "Explain this schema", "Suggest indexes". The AI returns DBML changes, shown as a diff the user must accept before they're applied.
- Calls go straight from the browser to the provider. Nothing goes through a server of ours.

### - [ ] 13. Seed data generator

- Generate realistic `INSERT` statements (choose rows per table) that respect FK order and constraints, with values matched to column names and types (email, name, price, dates). Use `@faker-js/faker`, lazy-loaded.

### - [ ] 14. Embed mode

- `/embed#s=…` renders a read-only, pan-and-zoom diagram with no editor or chrome, for docs sites and blogs. Add a "Copy embed code" button (`<iframe>` snippet) to the Share dialog.

---

## Housekeeping (anytime)

- [x] Vitest set up with a `pnpm test` script, run in CI
- [ ] Screenshots and a GIF in the README
- [ ] CONTRIBUTING.md and issue templates
