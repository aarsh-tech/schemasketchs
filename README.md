# Schemasketch

Draw database diagrams by writing [DBML](https://dbml.dbdiagram.io/docs). A free, local alternative to dbdiagram.io: no account, no backend, no database. Everything runs in the browser and your schemas are saved in `localStorage`.

## Roadmap

Planned features are listed in [ROADMAP.md](ROADMAP.md). Contributions are welcome.

## Features

- **Live diagram**: type DBML on the left, tables and relationships redraw on the right as you type
- **Two-way visual editing**: right-click a table to rename it, add a column, change its header colour or delete it; click a column to edit its name, type, keys, null and default; drag from a column's dot to another column to create a relationship; select a relationship and press Delete to remove it; add tables from the toolbar. Every change is written into the DBML with minimal edits that keep your comments and formatting, and Ctrl+Z in the editor undoes it
- **Schema checks**: as you type, the schema is checked for foreign keys without an index, tables without a primary key, nullability that doesn't match the relationship (including `>?` for optional ones), relationships between columns of different types, reserved words as names, mixed naming styles and tables over 40 columns. Findings show as yellow squiggles in the editor, a badge on the table, and a Problems list in the status bar; each check can be switched off per schema
- **Proper ER notation**: crow's-foot markers for one, zero-or-one, many and zero-or-many
- **Editor**: DBML syntax highlighting, inline errors, autocomplete for keywords, types, tables and columns
- **Canvas**: drag tables, auto-arrange (ELK layered layout), table groups, sticky notes, minimap, zoom
- **Command palette**: Ctrl/⌘+K (or the search button) jumps to any table or column, centring it on the canvas and in the code, and runs any command: export, layout, theme, views, migrations and more. Fuzzy matching, keyboard first
- **Focus mode**: right-click a table (or use the palette) to show only it and its neighbours up to 1, 2 or 3 relationships away, dimming or hiding the rest. Esc leaves it
- **Highlighting**: hover a table or put your cursor inside its definition to highlight its relationships; double-click a table to jump to its code
- **Views**: tabs above the canvas show named subsets of the schema ("Auth", "Billing"), each with its own layout, while the DBML stays one source. Create one from the + tab (tables selected on the canvas start it off), pick tables with a filterable list, add a table from its right-click menu, and use "Show related tables" to pull in neighbours. Views follow table renames and travel in project files and share links
- **Column views**: all columns, keys only, or table names only
- **Multiple schemas**: create, rename, duplicate and delete, all kept in this browser
- **Version history**: a snapshot is taken after 30 seconds without edits, or save one by hand with a label. Browse versions with their time and table-count change, preview the code read-only, and restore both the code and the layout. Stored in IndexedDB: up to 100 automatic snapshots per schema, and labelled ones are never removed
- **Migration generator**: compare two saved versions, a version and the current schema, or pasted DBML, and get a readable change summary plus up and down `ALTER` scripts for PostgreSQL or MySQL. Renamed tables are detected, and destructive steps (dropping a table, column or enum value) carry warning comments. Copy or download the SQL. Open it from File → Generate migration, or with "Compare with current" in the version history
- **Files**: open/save `.dbml` or project `.json` (schema + layout). On Chrome and Edge, saving writes straight back to the file you opened
- **Import SQL**: PostgreSQL, MySQL, SQL Server, Snowflake, Oracle and Rails `schema.rb`
- **ORM import and export**: import a Prisma `schema.prisma` or a Drizzle schema file (pg-core, mysql-core or sqlite-core) into DBML, with models, enums, relations, indexes and mapped names. Export the schema as a Prisma schema (PostgreSQL, MySQL or SQLite), a Drizzle schema (pg-core or mysql-core), TypeScript row interfaces or Zod 4 schemas. Anything a format can't hold is called out in a comment rather than silently dropped
- **Import from a live database, with no connection**: pick PostgreSQL, MySQL, SQLite or SQL Server and copy a ready-made read-only catalog query. Run it in your own client and paste back the JSON it returns (or drop the saved `.json` file): tables, columns, types, defaults, primary and foreign keys, indexes, enums and comments become DBML. Schemasketch never connects to the database
- **Export**: PNG, SVG, PDF (fitted to an A4 page, always in the light theme), SQL (PostgreSQL, MySQL, SQL Server, Oracle), Prisma, Drizzle, TypeScript, Zod, a Mermaid `erDiagram` that GitHub renders, a Markdown data dictionary (every table, column, type, key, note and relationship, with the Mermaid diagram on top), DBML, project JSON
- **Seed data**: Export → Seed data generates realistic `INSERT` statements for PostgreSQL, MySQL, SQLite or SQL Server, with rows per table you choose. Tables are filled parents first, foreign keys point at real rows, unique and composite keys don't repeat, circular references are completed with `UPDATE`s, and values match the column (emails, names, prices, ISBNs, dates, enum values, lengths). Shuffle for different data; faker.js is loaded only when you open it
- **Canvas undo and redo**: Ctrl/⌘+Z and Ctrl/⌘+Shift+Z (or the toolbar arrows) step through table moves and auto-layouts, separately from the editor's own undo
- **Share links**: the whole schema is compressed into the URL hash, so no server is involved
- **Embed**: Share → Embed gives an `<iframe>` snippet for docs sites and blogs. `/embed#s=…` shows a read-only diagram you can pan and zoom (hover a table to light up its relationships), in light, dark or the reader's theme, with a link to open a copy. It's a separate small page, so embeds never download the editor
- **Drag and drop** a file anywhere on the window to open it: `.dbml`, `.sql`, `schema.rb`, `.prisma`, a Drizzle `.ts` file, a project `.json` or a database catalog result `.json`. The format is detected and the right import tab opens
- **Live collaboration, no server of ours**: start a live session and send the invite link. Everyone edits the same DBML and layout at once, peer to peer over WebRTC (Yjs), with each person's cursor in the editor and their name on the table they're looking at. The link carries the encryption key, so a signalling server only sees encrypted connection setup. Leaving keeps a local copy. Tabs in one browser always connect; across devices you need a signalling server both sides can reach. The public `y-webrtc` servers were down when this was written, so run your own with `pnpm signaling` (it's tiny) and enter its address in the session dialog; the invite link passes it on
- **Installable and offline**: install Schemasketch as an app from the browser; after the first visit it opens without a connection. The app shell, fonts and parser are cached by a service worker; the large SQL import worker is cached the first time you use it. When a new version is deployed, a toast offers to reload
- Light and dark themes, works on phones

## Run it locally

Requires Node 20.19+ (22 recommended) and pnpm.

```bash
pnpm install
pnpm dev        # http://localhost:5173
```

Other scripts:

```bash
pnpm build      # type-check and build to dist/
pnpm preview    # serve the production build locally
pnpm lint       # oxlint
pnpm typecheck  # tsc only
pnpm test       # unit tests (Vitest)
PORT=4444 pnpm signaling   # a y-webrtc signalling server for live sessions across devices
```

## Deploy to Netlify

`netlify.toml` already sets the build command, publish folder, Node version, the `/embed` and SPA redirects, and cache headers. The app refuses to be framed (`X-Frame-Options: DENY` on `/`), while `/embed` is meant to be.

**From Git:** push the folder to GitHub, then in Netlify choose *Add new site → Import an existing project* and pick the repo. Netlify reads `netlify.toml` and detects pnpm from `pnpm-lock.yaml`. Nothing to fill in.

The build also writes a service worker (`sw.js`) and a web app manifest; `netlify.toml` tells browsers to re-check both on every visit so updates arrive.

**From your machine:**

```bash
pnpm build
npx netlify-cli deploy --prod --dir dist
```

## Keyboard shortcuts

| Action | Keys |
| --- | --- |
| Search tables, columns and commands | Ctrl/⌘ + K |
| Save | Ctrl/⌘ + S |
| Save as | Ctrl/⌘ + Shift + S |
| Open file | Ctrl/⌘ + O |
| Autocomplete | Ctrl + Space |
| Zoom canvas | Ctrl/⌘ + scroll, or pinch |
| Select several tables | Shift + drag |
| Table actions | Right-click a table |
| Edit a column | Click it |
| Delete the selected relationship | Delete |
| Undo a diagram edit | Ctrl/⌘ + Z in the editor |
| Undo or redo a table move | Ctrl/⌘ + Z, Ctrl/⌘ + Shift + Z on the canvas |
| Focus on a table | Right-click it → Focus on this table |
| Leave focus mode | Esc |

## How it works

```
src/
  lib/dbml/
    parse.worker.ts   DBML → schema model, and model → SQL (small worker, always loaded)
    sql.worker.ts     SQL → DBML import (large: every SQL grammar; loaded on first import)
    normalize.ts      turns @dbml/core's normalized model into a plain SchemaModel
    client.ts         promise-based RPC to both workers
  store/
    projects.ts       schemas, source text and table positions (persisted to localStorage)
    ui.ts             parsed model, theme, view options, cross-component requests
  components/
    editor/           CodeMirror 6 + a DBML stream language, linting and autocomplete
    canvas/           React Flow nodes, crow's-foot edges, ELK auto-layout
    dialogs/          import, export, share, help
  lib/diff/           schema diff → change summary and up/down migration SQL (pure functions, lazy-loaded)
  lib/convert/        Prisma and Drizzle ⇄ schema model, TypeScript and Zod output, model → DBML (pure, lazy-loaded)
  lib/catalog/        read-only catalog queries per database, and their JSON result → schema model (pure, lazy-loaded)
  lib/lint/           schema checks, one file per rule (pure, run after each parse)
  lib/views.ts        views: a named list of tables with its own layout, and the filtered model the canvas draws
  lib/search.ts       fuzzy matching for the command palette, and neighbourhoods for focus mode
  lib/collab/         live sessions: Yjs doc + y-webrtc + CodeMirror binding (lazy-loaded), invite links
  lib/seed/           seed data: insert order, keys and constraints, faker values per column (lazy-loaded)
  lib/layoutHistory.ts undo/redo steps for table positions; lib/pdf.ts writes a one-page PDF around a JPEG
  lib/files.ts        File System Access API with download fallbacks, share-link and embed-code encoding
  embed/              the read-only diagram page (embed.html), built as a second entry
```

Design decisions worth knowing:

- **The DBML text is the single source of truth.** Table positions are stored separately as `{ tableName: { x, y } }`, so re-parsing never moves your layout. Renaming one table carries its position over to the new name.
- **Parsing happens off the main thread** in a Web Worker, debounced while typing, so the editor never stutters on big schemas. If the source has errors, the last good diagram stays on screen.
- **`@dbml/core` is split.** Its main entry bundles every SQL grammar (~15 MB). The live parser imports only the model and exporter modules through Vite aliases (see `vite.config.ts`), keeping the always-loaded worker around 600 KB. The full package loads only when you import SQL.
- **ORM converters don't need the ORMs.** Prisma schemas are read by a small hand-written parser, and Drizzle files by a forgiving reader for the slice of TypeScript that schema files use, so nothing heavy ships to the browser. The tests check the output with the real tools instead: Prisma's own schema validator, and the TypeScript compiler against `drizzle-orm` and `zod`.
- **New tables avoid overlap**: they're placed in the nearest free spot to the middle of the current view.

## Stack

React 19, TypeScript, Vite, Tailwind CSS 4, Zustand, React Flow (`@xyflow/react`), CodeMirror 6, `@dbml/core` / `@dbml/parse`, ELK.js, html-to-image, lz-string. Fonts (Schibsted Grotesk, JetBrains Mono) are bundled locally, so the app works offline after the first load.

## License

MIT
