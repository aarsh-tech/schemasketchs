/* Read-only catalog queries. Each returns one JSON value describing the
   tables, columns, keys, indexes and enums of the database it runs in. The
   rows are flat (one per column, index column, key column or enum value) so
   the queries stay simple; catalog.ts groups them back together. */

export type CatalogDialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql'

export const CATALOG_DIALECTS: { value: CatalogDialect; label: string }[] = [
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'sqlite', label: 'SQLite' },
  { value: 'mssql', label: 'SQL Server' },
]

const POSTGRES = `-- Schemasketch catalog query for PostgreSQL 11 or later.
-- It only reads the system catalog and returns one JSON value.
WITH tbl AS (
  SELECT c.oid, n.nspname AS schema_name, c.relname AS table_name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p')
    AND NOT c.relispartition
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg\\_%'
)
SELECT json_build_object(
  'dialect', 'postgres',
  'tables', (
    SELECT coalesce(json_agg(json_build_object(
      'schema', t.schema_name, 'table', t.table_name, 'comment', obj_description(t.oid, 'pg_class')
    ) ORDER BY t.schema_name, t.table_name), '[]')
    FROM tbl t
  ),
  'columns', (
    SELECT coalesce(json_agg(json_build_object(
      'schema', t.schema_name, 'table', t.table_name, 'column', a.attname, 'position', a.attnum,
      'type', format_type(a.atttypid, a.atttypmod),
      'nullable', NOT a.attnotnull,
      'default', pg_get_expr(d.adbin, d.adrelid),
      'identity', a.attidentity <> '',
      'comment', col_description(t.oid, a.attnum)
    ) ORDER BY t.schema_name, t.table_name, a.attnum), '[]')
    FROM tbl t
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  ),
  'indexes', (
    SELECT coalesce(json_agg(json_build_object(
      'schema', t.schema_name, 'table', t.table_name, 'name', ic.relname,
      'column', a.attname,
      'expression', CASE WHEN k.attnum = 0 THEN pg_get_indexdef(i.indexrelid, k.seq::int, true) END,
      'seq', k.seq, 'unique', i.indisunique, 'primary', i.indisprimary,
      'method', am.amname, 'partial', i.indpred IS NOT NULL
    ) ORDER BY t.schema_name, t.table_name, ic.relname, k.seq), '[]')
    FROM tbl t
    JOIN pg_index i ON i.indrelid = t.oid
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_am am ON am.oid = ic.relam
    CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, seq)
    LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum AND k.attnum > 0
    WHERE k.seq <= i.indnkeyatts
  ),
  'foreign_keys', (
    SELECT coalesce(json_agg(json_build_object(
      'schema', t.schema_name, 'table', t.table_name, 'name', con.conname,
      'column', a.attname, 'seq', k.seq,
      'ref_schema', rn.nspname, 'ref_table', rc.relname, 'ref_column', ra.attname,
      'on_delete', con.confdeltype, 'on_update', con.confupdtype
    ) ORDER BY t.schema_name, t.table_name, con.conname, k.seq), '[]')
    FROM tbl t
    JOIN pg_constraint con ON con.conrelid = t.oid AND con.contype = 'f'
    CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(attnum, refattnum, seq)
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
    JOIN pg_class rc ON rc.oid = con.confrelid
    JOIN pg_namespace rn ON rn.oid = rc.relnamespace
    JOIN pg_attribute ra ON ra.attrelid = con.confrelid AND ra.attnum = k.refattnum
  ),
  'enums', (
    SELECT coalesce(json_agg(json_build_object(
      'schema', n.nspname, 'name', ty.typname, 'value', e.enumlabel, 'seq', e.enumsortorder
    ) ORDER BY n.nspname, ty.typname, e.enumsortorder), '[]')
    FROM pg_enum e
    JOIN pg_type ty ON ty.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = ty.typnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  )
) AS catalog;
`

const MYSQL = `-- Schemasketch catalog query for MySQL 5.7.22 or later, and MariaDB 10.5 or later.
-- It reads the current database's information_schema and returns one JSON value.
SELECT JSON_OBJECT(
  'dialect', 'mysql',
  'tables', (
    SELECT JSON_ARRAYAGG(JSON_OBJECT('schema', t.TABLE_SCHEMA, 'table', t.TABLE_NAME, 'comment', t.TABLE_COMMENT))
    FROM information_schema.TABLES t
    WHERE t.TABLE_SCHEMA = DATABASE() AND t.TABLE_TYPE = 'BASE TABLE'
  ),
  'columns', (
    SELECT JSON_ARRAYAGG(JSON_OBJECT(
      'schema', c.TABLE_SCHEMA, 'table', c.TABLE_NAME, 'column', c.COLUMN_NAME, 'position', c.ORDINAL_POSITION,
      'type', c.COLUMN_TYPE, 'nullable', c.IS_NULLABLE = 'YES', 'default', c.COLUMN_DEFAULT,
      'extra', c.EXTRA, 'comment', c.COLUMN_COMMENT
    ))
    FROM information_schema.COLUMNS c
    JOIN information_schema.TABLES t
      ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
    WHERE c.TABLE_SCHEMA = DATABASE()
  ),
  'indexes', (
    SELECT JSON_ARRAYAGG(JSON_OBJECT(
      'schema', s.TABLE_SCHEMA, 'table', s.TABLE_NAME, 'name', s.INDEX_NAME, 'column', s.COLUMN_NAME,
      'seq', s.SEQ_IN_INDEX, 'unique', s.NON_UNIQUE = 0, 'primary', s.INDEX_NAME = 'PRIMARY', 'method', s.INDEX_TYPE
    ))
    FROM information_schema.STATISTICS s
    WHERE s.TABLE_SCHEMA = DATABASE()
  ),
  'foreign_keys', (
    SELECT JSON_ARRAYAGG(JSON_OBJECT(
      'schema', k.TABLE_SCHEMA, 'table', k.TABLE_NAME, 'name', k.CONSTRAINT_NAME, 'column', k.COLUMN_NAME,
      'seq', k.ORDINAL_POSITION, 'ref_schema', k.REFERENCED_TABLE_SCHEMA, 'ref_table', k.REFERENCED_TABLE_NAME,
      'ref_column', k.REFERENCED_COLUMN_NAME, 'on_delete', r.DELETE_RULE, 'on_update', r.UPDATE_RULE
    ))
    FROM information_schema.KEY_COLUMN_USAGE k
    JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
    WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL
  )
) AS catalog;
`

const SQLITE = `-- Schemasketch catalog query for SQLite 3.38 or later (JSON functions built in).
-- It reads the schema with PRAGMA functions and returns one JSON value.
SELECT json_object(
  'dialect', 'sqlite',
  'tables', json((
    SELECT json_group_array(json_object('table', m.name))
    FROM sqlite_master m
    WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
  )),
  'columns', json((
    SELECT json_group_array(json_object(
      'table', m.name, 'column', p.name, 'position', p.cid, 'type', p.type,
      'nullable', p."notnull" = 0, 'default', p.dflt_value, 'pk', p.pk,
      'identity', p.pk = 1 AND upper(p.type) = 'INTEGER' AND m.sql LIKE '%autoincrement%'
    ))
    FROM sqlite_master m
    JOIN pragma_table_info(m.name) p
    WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
  )),
  'indexes', json((
    SELECT json_group_array(json_object(
      'table', m.name, 'name', il.name, 'column', ii.name, 'seq', ii.seqno + 1,
      'unique', il."unique", 'primary', il.origin = 'pk', 'partial', il.partial
    ))
    FROM sqlite_master m
    JOIN pragma_index_list(m.name) il
    JOIN pragma_index_info(il.name) ii
    WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
  )),
  'foreign_keys', json((
    SELECT json_group_array(json_object(
      'table', m.name, 'id', fk.id, 'column', fk."from", 'seq', fk.seq + 1,
      'ref_table', fk."table", 'ref_column', fk."to", 'on_delete', fk.on_delete, 'on_update', fk.on_update
    ))
    FROM sqlite_master m
    JOIN pragma_foreign_key_list(m.name) fk
    WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
  ))
) AS catalog;
`

const MSSQL = `-- Schemasketch catalog query for SQL Server 2016 or later, and Azure SQL.
-- It reads the sys catalog views and returns one JSON value.
SET NOCOUNT ON;
SELECT CAST((
  SELECT
    'mssql' AS dialect,
    (
      SELECT s.name AS [schema], t.name AS [table], CAST(ep.value AS nvarchar(max)) AS comment
      FROM sys.tables t
      JOIN sys.schemas s ON s.schema_id = t.schema_id
      LEFT JOIN sys.extended_properties ep
        ON ep.class = 1 AND ep.major_id = t.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
      WHERE t.is_ms_shipped = 0
      FOR JSON PATH, INCLUDE_NULL_VALUES
    ) AS tables,
    (
      SELECT s.name AS [schema], t.name AS [table], c.name AS [column], c.column_id AS position,
        TYPE_NAME(c.user_type_id) + CASE
          WHEN TYPE_NAME(c.user_type_id) IN ('varchar', 'char', 'varbinary', 'binary')
            THEN '(' + CASE WHEN c.max_length = -1 THEN 'max' ELSE CAST(c.max_length AS varchar(10)) END + ')'
          WHEN TYPE_NAME(c.user_type_id) IN ('nvarchar', 'nchar')
            THEN '(' + CASE WHEN c.max_length = -1 THEN 'max' ELSE CAST(c.max_length / 2 AS varchar(10)) END + ')'
          WHEN TYPE_NAME(c.user_type_id) IN ('decimal', 'numeric')
            THEN '(' + CAST(c.precision AS varchar(10)) + ',' + CAST(c.scale AS varchar(10)) + ')'
          ELSE '' END AS type,
        c.is_nullable AS nullable, dc.definition AS [default], c.is_identity AS [identity],
        CAST(ep.value AS nvarchar(max)) AS comment
      FROM sys.columns c
      JOIN sys.tables t ON t.object_id = c.object_id
      JOIN sys.schemas s ON s.schema_id = t.schema_id
      LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
      LEFT JOIN sys.extended_properties ep
        ON ep.class = 1 AND ep.major_id = c.object_id AND ep.minor_id = c.column_id AND ep.name = 'MS_Description'
      WHERE t.is_ms_shipped = 0
      FOR JSON PATH, INCLUDE_NULL_VALUES
    ) AS columns,
    (
      SELECT s.name AS [schema], t.name AS [table], i.name AS name, c.name AS [column], ic.key_ordinal AS seq,
        i.is_unique AS [unique], i.is_primary_key AS [primary], i.has_filter AS partial
      FROM sys.indexes i
      JOIN sys.tables t ON t.object_id = i.object_id
      JOIN sys.schemas s ON s.schema_id = t.schema_id
      JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE t.is_ms_shipped = 0 AND i.type > 0
      FOR JSON PATH, INCLUDE_NULL_VALUES
    ) AS indexes,
    (
      SELECT s.name AS [schema], t.name AS [table], fk.name AS name, c.name AS [column], fkc.constraint_column_id AS seq,
        rs.name AS ref_schema, rt.name AS ref_table, rc.name AS ref_column,
        fk.delete_referential_action_desc AS on_delete, fk.update_referential_action_desc AS on_update
      FROM sys.foreign_keys fk
      JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
      JOIN sys.tables t ON t.object_id = fk.parent_object_id
      JOIN sys.schemas s ON s.schema_id = t.schema_id
      JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
      JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
      JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
      JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
      FOR JSON PATH, INCLUDE_NULL_VALUES
    ) AS foreign_keys
  FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS nvarchar(max)) AS catalog;
`

export const CATALOG_QUERIES: Record<CatalogDialect, string> = { postgres: POSTGRES, mysql: MYSQL, sqlite: SQLITE, mssql: MSSQL }

/** How to run the query and get the JSON out, per database. */
export const CATALOG_HOWTO: Record<CatalogDialect, string> = {
  postgres: 'Run it in psql, pgAdmin, DBeaver or any client and copy the single value it returns. From a terminal: psql -At -f catalog.sql your_db > catalog.json',
  mysql: 'Run it while connected to the database you want (USE your_db) and copy the single value. From a terminal: mysql -N -r -e "source catalog.sql" your_db > catalog.json',
  sqlite: 'Run it on the database file and copy the single value. From a terminal: sqlite3 your.db < catalog.sql > catalog.json',
  mssql: 'Run it in SSMS or Azure Data Studio on the database you want and copy the single value. SSMS cuts long values in the grid: raise Tools → Options → Query Results → Results to Grid → Non XML data to 2 MB, or use sqlcmd -y 0.',
}
