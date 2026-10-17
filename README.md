# Schemasketch

Draw database diagrams by writing [DBML](https://dbml.dbdiagram.io/docs). A free, local alternative to dbdiagram.io: no account, no backend, no database. Everything runs in the browser and your schemas are saved in `localStorage`.

## Roadmap

Planned features are listed in [ROADMAP.md](ROADMAP.md). Contributions are welcome.

## Features

- **Live diagram**: type DBML on the left, tables and relationships redraw on the right as you type
- **Two-way visual editing**: right-click a table to rename it, add a column, change its header colour or delete it; click a column to edit its name, type, keys, null and default; drag from a column's dot to another column to create a relationship; select a relationship and press Delete to remove it; add tables from the toolbar. Every change is written into the DBML with minimal edits that keep your comments and formatting, and Ctrl+Z in the editor undoes it
- **Proper ER notation**: crow's-foot markers for one, zero-or-one, many and zero-or-many
- **Editor**: DBML syntax highlighting, inline errors, autocomplete for keywords, types, tables and columns
- **Canvas**: drag tables, auto-arrange (ELK layered layout), table groups, sticky notes, minimap, zoom
- **Focus**: hover a table or put your cursor inside its definition to highlight its relationships; double-click a table to jump to its code
- **Column views**: all columns, keys only, or table names only
- **Multiple schemas**: create, rename, duplicate and delete, all kept in this browser
- **Files**: open/save `.dbml` or project `.json` (schema + layout). On Chrome and Edge, saving writes straight back to the file you opened
- **Import SQL**: PostgreSQL, MySQL, SQL Server, Snowflake, Oracle and Rails `schema.rb`
- **Export**: PNG, SVG, SQL (PostgreSQL, MySQL, SQL Server, Oracle), DBML, project JSON
- **Share links**: the whole schema is compressed into the URL hash, so no server is involved
- **Drag and drop** a file anywhere on the window to open it
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
```

## Deploy to Netlify

`netlify.toml` already sets the build command, publish folder, Node version, SPA redirect and cache headers.

**From Git:** push the folder to GitHub, then in Netlify choose *Add new site → Import an existing project* and pick the repo. Netlify reads `netlify.toml` and detects pnpm from `pnpm-lock.yaml`. Nothing to fill in.

**From your machine:**

```bash
pnpm build
npx netlify-cli deploy --prod --dir dist
```

## Keyboard shortcuts

| Action | Keys |
| --- | --- |
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
  lib/files.ts        File System Access API with download fallbacks, share-link encoding
```

Design decisions worth knowing:

- **The DBML text is the single source of truth.** Table positions are stored separately as `{ tableName: { x, y } }`, so re-parsing never moves your layout. Renaming one table carries its position over to the new name.
- **Parsing happens off the main thread** in a Web Worker, debounced while typing, so the editor never stutters on big schemas. If the source has errors, the last good diagram stays on screen.
- **`@dbml/core` is split.** Its main entry bundles every SQL grammar (~15 MB). The live parser imports only the model and exporter modules through Vite aliases (see `vite.config.ts`), keeping the always-loaded worker around 600 KB. The full package loads only when you import SQL.
- **New tables avoid overlap**: they're placed in the nearest free spot to the middle of the current view.

## Stack

React 19, TypeScript, Vite, Tailwind CSS 4, Zustand, React Flow (`@xyflow/react`), CodeMirror 6, `@dbml/core` / `@dbml/parse`, ELK.js, html-to-image, lz-string. Fonts (Schibsted Grotesk, JetBrains Mono) are bundled locally, so the app works offline after the first load.

## License

MIT
