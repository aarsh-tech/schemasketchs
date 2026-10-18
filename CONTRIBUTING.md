# Contributing to Schemasketch

Thanks for helping. Schemasketch is a static React app with no backend: everything runs in the browser and schemas live in `localStorage`. Keep it that way. Nothing you add may need a server of ours.

## Get it running

You need Node 20.19 or later (22 recommended) and pnpm. Use pnpm only; there's no npm or yarn lockfile.

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

Before you open a pull request, all four of these must pass:

```bash
pnpm typecheck
pnpm lint         # oxlint, zero warnings
pnpm test         # Vitest
pnpm build
```

CI runs the same four on every push and pull request.

Two other scripts are useful:

- `pnpm preview` serves the production build. The service worker (offline support) only registers in a production build, so test PWA changes there.
- Live sessions connect through public Nostr relays, so to test one between two browsers, open the invite link in a second browser profile (tabs in one profile also connect, over a BroadcastChannel).

## How the code fits together

The short version is below; `CLAUDE.md` has the full map of folders and stores.

- **The DBML text is the only copy of the schema.** Anything changed on the canvas is written back into the text through `src/lib/dbml/edit.ts`, as minimal edits that keep comments and formatting. Never keep a second copy of the schema that could drift from the text.
- **Table positions live apart from the text**, in `project.positions` (and in each view's own `positions`).
- **Parsing happens in a Web Worker** (`src/lib/dbml/parse.worker.ts`). Don't import `@dbml/core`'s main entry on the main thread: it bundles every SQL grammar (about 15 MB). Only `sql.worker.ts` may.
- **Heavy code is loaded on demand** with `import()`: the ORM converters, the migration diff, the catalog import, the seed generator (faker), live sessions (Yjs and WebRTC) and ELK layout. Keep the main bundle small; `pnpm build` prints its size.
- **The embed page** (`embed.html` and `src/embed/`) is a second entry. It must not import the editor, the stores or anything else the app uses for editing.
- **Logic that can be pure should be**, in `src/lib/`, with tests next to it.

## Writing code

- TypeScript is strict. Avoid `any`, and avoid `as` casts unless you're narrowing data you can't type, such as JSON from outside.
- Never call `setState` synchronously inside an effect; oxlint flags it. Derive values while rendering, or remount with a `key`. Setting state in a callback (an event, a promise, a subscription) is fine.
- When you change a persisted data shape (`schemasketch:projects`, `schemasketch:ui`, project `.json` files, share links), make sure old data still loads: bump the persist `version` and add a `migrate`.
- Match the code around you: its naming, its comment style (comments say why, not what), and its file layout.

## UI conventions

- **Colours come only from the tokens** in `src/index.css` (`--c-*`), used through Tailwind classes such as `bg-panel`, `text-ink-2` and `border-line`. No hex values in components. Everything must work in light and dark.
- Reuse the primitives in `src/components/ui/primitives.tsx` (Button, IconButton, Menu, Dialog, Popover, Tabs, Segmented). Dialogs go in `Dialogs.tsx` and open through `useDialogs`.
- Copy is sentence case, plain and specific. A button says what it does ("Generate migration", not "Submit"). An error message says what went wrong and how to fix it.
- Everything must be keyboard-reachable with a visible focus ring, and must work at phone width (about 390 px).

## Tests

- Pure logic gets Vitest tests (`*.test.ts` next to the code).
- Prefer checks against the real thing over hand-written expectations: the catalog import runs its PostgreSQL query in PGlite and its SQLite query in `node:sqlite`; seed data is loaded into PGlite with every constraint enforced; Mermaid output goes through Mermaid's own parser; Prisma output through Prisma's validator.
- UI changes: try them in `pnpm dev`, in light and dark and at phone width, and make sure the sample Bookshop schema still renders.

## Pull requests

- One feature or fix per pull request, with a description of what changed and why.
- Update the feature list in `README.md` when you add something users will see, and add a short entry to `CHANGELOG.md`.
- Commit messages follow `type: summary`, for example `feat: seed data generator (#13)` or `fix: keep the editor scrolled after an import`.

## Reporting bugs and asking for features

Use the issue templates. For a bug, the smallest DBML that shows it is the most useful thing you can include; a share link (Share → Copy link) carries the whole schema and layout.
