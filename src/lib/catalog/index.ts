import { toDbml } from '@/lib/convert/dbml'
import { DATABASE_LABEL, catalogToModel } from './catalog'

/* Entry point for importing a database catalog. The app loads this module
   with a dynamic import(), so none of it is in the main bundle. */

export { CATALOG_DIALECTS, CATALOG_HOWTO, CATALOG_QUERIES } from './queries'
export type { CatalogDialect } from './queries'
export { CatalogError, catalogToModel, readCatalogText } from './catalog'

export interface CatalogImport {
  dbml: string
  tables: number
  warnings: string[]
}

export function importCatalog(text: string): CatalogImport {
  const { model, warnings, dialect } = catalogToModel(text)
  const header = [
    `Imported from a ${DATABASE_LABEL[dialect]} catalog by Schemasketch.`,
    ...(warnings.length ? ['', 'Not converted:', ...warnings.map((w) => `- ${w}`)] : []),
  ].join('\n')
  return { dbml: toDbml(model, { header }), tables: model.tables.length, warnings }
}
