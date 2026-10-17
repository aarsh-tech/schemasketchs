import type { SchemaModel } from '@/lib/dbml/types'
import { fkIndex } from './rules/fkIndex'
import { mixedNaming } from './rules/naming'
import { nullableFk } from './rules/nullableFk'
import { missingPrimaryKey } from './rules/primaryKey'
import { refTypes } from './rules/refTypes'
import { reservedWords } from './rules/reservedWords'
import { wideTable } from './rules/wideTable'
import type { LintRule, Problem } from './types'

export type { LintRule, Problem } from './types'

/* Schema linting: pure rules over the parsed model. They're small, so they
   run on the main thread straight after each parse. */

export const RULES: LintRule[] = [missingPrimaryKey, fkIndex, nullableFk, refTypes, reservedWords, mixedNaming, wideTable]

export function lintSchema(model: SchemaModel, disabled: readonly string[] = []): Problem[] {
  const off = new Set(disabled)
  return RULES.filter((r) => !off.has(r.id)).flatMap((r) => r.check(model))
}
