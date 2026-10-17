# Schemasketch: notes for Claude Code

Schemasketch draws database diagrams from DBML. It's a static React app with **no backend and no database**: everything runs in the browser, and projects are stored in `localStorage`. It deploys to Netlify as static files. The feature roadmap is in `ROADMAP.md`.

## Commands (pnpm only, never npm or yarn)

```bash
pnpm install
pnpm dev         # http://localhost:5173
pnpm build       # tsc -b && vite build; must pass before you say a task is done
pnpm lint        # oxlint; keep it at zero warnings
pnpm typecheck
```

Before finishing any task, run `pnpm typecheck`, `pnpm lint` and `pnpm build`, and fix whatever they report.

## Stack

React 19, TypeScript (strict), Vite 8 (rolldown), Tailwind CSS 4, Zustand 5, React Flow (`@xyflow/react` 12), CodeMirror 6 (`@uiw/react-codemirror`), `@dbml/core` + `@dbml/parse` 10.3.1, elkjs, html-to-image, lz-string, sonner (toasts), lucide-react (icons), react-resizable-panels 4.

## Architecture

```
src/
  App.tsx                  providers, global hooks, toaster
  store/projects.ts        projects: { name, source (DBML), positions, lastGoodSource }; persisted
  store/ui.ts              parsed model, diagnostics, theme, view options, cross-component "requests"
  store/dialogs.ts         which dialog is open
  hooks/useSchemaSync.ts   debounced parse of the active project's source in a worker
  lib/dbml/
    parse.worker.ts        DBML → SchemaModel, and DBML → SQL export (small worker)
    sql.worker.ts          SQL → DBML import (huge: all SQL grammars; lazy-loaded)
    compile.ts             DBML → SchemaModel via @dbml/parse (worker and tests only)
    normalize.ts           @dbml/core normalized model → our plain SchemaModel
    types.ts               SchemaModel, TableModel, FieldModel, RefModel, …
    client.ts              promise RPC to both workers
  lib/diff/                SchemaModel diff, change summary, up/down migration SQL (pure; lazy-loaded)
  lib/convert/             Prisma/Drizzle ⇄ SchemaModel, TypeScript/Zod export, SchemaModel → DBML (pure; lazy-loaded)
  lib/catalog/             catalog queries per database + their JSON result → SchemaModel (pure; lazy-loaded)
  lib/lint/                schema lint rules, one per file in rules/ (pure; run via hooks/useProblems)
  lib/actions.ts           user-level actions (open, save, import, export, share)
  lib/files.ts             File System Access API + fallbacks, share-link encoding
  components/editor/       CodeMirror: DBML stream language, lint, autocomplete
  components/canvas/       React Flow: nodes.tsx, edges.tsx (crow's foot), graph.ts (model → nodes/edges), layout.ts (ELK)
  components/dialogs/      all dialogs in Dialogs.tsx
  components/ui/           Button, IconButton, Menu, Dialog, Segmented, Kbd
```

## Rules that keep the app working

- **The DBML text is the single source of truth.** Anything the user changes visually must be written back into the DBML text. Never keep a second schema copy that can drift from it.
- **Positions live apart from the text**, in `project.positions`, keyed by node id (table id is `name`, or `schema.name` outside `public`; sticky notes are `note:<name>`).
- **Parsing only happens in the worker.** Never import `@dbml/core`'s main entry on the main thread: it pulls in about 15 MB of SQL grammars. The parse worker imports internals through the Vite aliases `@dbml-core-database` and `@dbml-core-exporter` (see `vite.config.ts` and `lib/dbml/vendor.d.ts`). Only `sql.worker.ts` may import `@dbml/core` itself.
- **Heavy libraries are lazy-loaded** with dynamic `import()` (elkjs already is). Keep the main bundle small.
- **Never call setState inside an effect.** oxlint flags it. Derive values during render, or remount with a `key`.
- **Persisted data shapes** (`schemasketch:projects`, `schemasketch:ui`, project `.json` files, share links): when you change one, keep old data loading. Bump the persist `version` and add a `migrate`.

## UI conventions

- **Colors only from tokens.** Use the `--c-*` CSS variables in `src/index.css`, exposed to Tailwind as `bg-panel`, `text-ink-2`, `border-line`, `text-accent` and so on. Never hard-code hex values in components. Every UI must work in light and dark.
- Fonts: Schibsted Grotesk (UI) and JetBrains Mono (code, column types).
- Reuse the primitives in `components/ui/primitives.tsx` before writing new ones. Dialogs go in `Dialogs.tsx` and open through `useDialogs`.
- Copy is sentence case, plain and specific. A button says what it does ("Generate migration", not "Submit"). Error messages say what went wrong and how to fix it.
- Make everything keyboard reachable with a visible focus ring, and make it work at phone width (the mobile layout lives in `Workspace.tsx`).
- Toasts come from `sonner`: `toast.success`, `toast.error(title, { description })`.

## Before you say a feature is done

1. Typecheck, lint and build all pass.
2. You've tried it in the browser at `pnpm dev`, in light and dark, and at phone width.
3. The sample Bookshop schema (`src/lib/sample.ts`) still renders correctly.
4. The README's feature list is updated, and the item is ticked off in `ROADMAP.md`.
