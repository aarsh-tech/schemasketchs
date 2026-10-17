import { describe, expect, it } from 'vitest'
import { diffSchemas, summarize } from '@/lib/diff'
import type { SchemaModel } from '@/lib/dbml/types'
import { toDbml } from './dbml'
import { fromDrizzle, toDrizzle } from './drizzle'
import { fromPrisma, toPrisma } from './prisma'
import { FIXTURES, parse } from './testing'

/* DBML → ORM → DBML for every fixture, compared with the migration diff.
   What a format can't hold is listed here, so a new loss shows up as a failure. */

const changes = (a: SchemaModel, model: SchemaModel) => summarize(diffSchemas(a, parse(toDbml(model)))).map((s) => `${s.kind} ${s.subject}: ${s.text}`)

const PRISMA_LOSSES: Record<string, string[]> = {
  // Prisma can't index an expression, and writes PostgreSQL numeric as its twin decimal
  'postgres features': ['remove auth.users: index (`lower(handle)`) removed', 'change posts.amount: type numeric(12,4) → decimal(12,4)'],
}

const DRIZZLE_LOSSES: Record<string, string[]> = {
  // Drizzle has no many-to-many column; it needs a join table
  relations: ['remove people.id → clubs.id: relationship removed'],
}

describe('round trip through Prisma', () => {
  for (const f of FIXTURES) {
    it(f.name, () => {
      const a = parse(f.dbml)
      expect(changes(a, fromPrisma(toPrisma(a)).model)).toEqual(PRISMA_LOSSES[f.name] ?? [])
    })
  }
})

describe('round trip through Drizzle', () => {
  for (const f of FIXTURES) {
    it(f.name, () => {
      const a = parse(f.dbml)
      expect(changes(a, fromDrizzle(toDrizzle(a)).model)).toEqual(DRIZZLE_LOSSES[f.name] ?? [])
    })
  }
})
