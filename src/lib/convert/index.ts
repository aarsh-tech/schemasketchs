import type { SchemaModel } from '@/lib/dbml/types'
import { toDbml } from './dbml'
import { fromDrizzle, toDrizzle } from './drizzle'
import type { DrizzleDialect } from './drizzle'
import { fromPrisma, toPrisma } from './prisma'
import type { PrismaProvider } from './prisma'
import { toTypeScript, toZod } from './typescript'

/* Entry point for the ORM converters. The app loads this module with a
   dynamic import(), so none of it is in the main bundle. */

export type OrmImportFormat = 'prisma' | 'drizzle'
export type OrmExportFormat = 'prisma' | 'drizzle' | 'typescript' | 'zod'
export type OrmTarget = 'postgres' | 'mysql' | 'sqlite'

export { drizzleDialectFor } from './drizzle'
export { providerFor } from './prisma'

export interface OrmImport {
  dbml: string
  tables: number
  warnings: string[]
}

export function importOrm(format: OrmImportFormat, text: string): OrmImport {
  const { model, warnings } = format === 'prisma' ? fromPrisma(text) : fromDrizzle(text)
  const label = format === 'prisma' ? 'a Prisma schema' : 'a Drizzle schema'
  const header = [`Imported from ${label} by Schemasketch.`, ...(warnings.length ? ['', 'Not converted:', ...warnings.map((w) => `- ${w}`)] : [])].join('\n')
  return { dbml: toDbml(model, { header }), tables: model.tables.length, warnings }
}

const PRISMA_PROVIDER: Record<OrmTarget, PrismaProvider> = { postgres: 'postgresql', mysql: 'mysql', sqlite: 'sqlite' }

export function exportOrm(format: OrmExportFormat, model: SchemaModel, target: OrmTarget): string {
  switch (format) {
    case 'prisma':
      return toPrisma(model, { provider: PRISMA_PROVIDER[target] })
    case 'drizzle':
      return toDrizzle(model, { dialect: (target === 'sqlite' ? 'postgres' : target) satisfies DrizzleDialect })
    case 'typescript':
      return toTypeScript(model)
    case 'zod':
      return toZod(model)
  }
}
