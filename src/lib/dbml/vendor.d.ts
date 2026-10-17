declare module '@dbml-core-database' {
  /** Model class from @dbml/core (lib/model_structure/database.mjs). */
  export default class Database {
    constructor(raw: unknown)
    normalize(): unknown
  }
}

declare module '@dbml-core-exporter' {
  /** SQL/DBML exporter from @dbml/core (lib/export/ModelExporter.mjs). */
  const ModelExporter: {
    export(model: unknown, format: 'dbml' | 'mysql' | 'postgres' | 'json' | 'mssql' | 'oracle'): string
  }
  export default ModelExporter
}
