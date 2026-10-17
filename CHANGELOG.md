# Changelog

## Two-way visual editing (#1)
Edits on the canvas now write back into the DBML: a table menu (rename, add column, header colour, delete), a column popover, drag-to-relate with a cardinality picker, Delete on a selected relationship, and an "Add table" button.
All changes go through `src/lib/dbml/edit.ts`, which makes minimal text edits located with the @dbml/parse syntax tree inside the parse worker, and each lands in the editor as one undoable change. Vitest is set up (`pnpm test`, run in CI) with 40 tests for the edit module.
