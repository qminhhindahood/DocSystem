import { execFileSync } from 'node:child_process';
import 'dotenv/config';
import { Client } from 'pg';
import { prepareDatabase } from '../src/scripts/prepare_database';

export const BASELINE_MIGRATION = '20250608000000_rename_ollama_to_lmstudio';

export interface CatalogInspection {
  publicSchemaExists: true;
  prismaMigrationsRelationExists: boolean;
  applicationTables: string[];
  applicationObjects: string[];
  appliedMigrations: string[];
}

export interface DeployFreshDatabaseDependencies {
  prepareDatabase: (databaseUrl: string) => Promise<string>;
  inspectCatalog: (databaseUrl: string) => Promise<CatalogInspection>;
  runNative: (
    command: string,
    args: readonly string[],
    databaseUrl: string,
  ) => void | Promise<void>;
}

type ObjectRow = { object_name: string };
type TableRow = { table_name: string };
type SchemaRow = { public_schema_exists: boolean };
type MigrationRelationRow = { prisma_migrations_relation_exists: boolean };

export async function inspectPostgresCatalog(
  databaseUrl: string,
): Promise<CatalogInspection> {
  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    const schema = await client.query<SchemaRow>(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_namespace
        WHERE nspname = 'public'
      ) AS public_schema_exists
    `);
    const migrationRelation = await client.query<MigrationRelationRow>(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS c
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = '_prisma_migrations'
      ) AS prisma_migrations_relation_exists
    `);
    const objects = await client.query<ObjectRow>(`
      SELECT object_name
      FROM (
        SELECT
          CASE c.relkind
            WHEN 'r' THEN 'table'
            WHEN 'p' THEN 'partitioned table'
            WHEN 'v' THEN 'view'
            WHEN 'm' THEN 'materialized view'
            WHEN 'S' THEN 'sequence'
            WHEN 'f' THEN 'foreign table'
            WHEN 'i' THEN 'index'
            WHEN 'I' THEN 'partitioned index'
            WHEN 'c' THEN 'composite type'
            ELSE 'relation'
          END || ':' || c.relname AS object_name
        FROM pg_catalog.pg_class AS c
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_depend AS d
            WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
              AND d.objid = c.oid
              AND d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
              AND d.deptype = 'e'
          )
          AND NOT (c.relname = '_prisma_migrations' AND c.relkind = 'r')
          AND NOT (
            c.relkind IN ('i', 'I')
            AND EXISTS (
              SELECT 1
              FROM pg_catalog.pg_index AS i
              JOIN pg_catalog.pg_class AS m ON m.oid = i.indrelid
              JOIN pg_catalog.pg_namespace AS mn ON mn.oid = m.relnamespace
              WHERE i.indexrelid = c.oid
                AND mn.nspname = 'public'
                AND m.relname = '_prisma_migrations'
                AND m.relkind = 'r'
            )
          )

        UNION ALL

        SELECT 'type:' || t.typname AS object_name
        FROM pg_catalog.pg_type AS t
        JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typrelid = 0
          AND t.typelem = 0
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_depend AS d
            WHERE d.classid = 'pg_catalog.pg_type'::pg_catalog.regclass
              AND d.objid = t.oid
              AND d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
              AND d.deptype = 'e'
          )

        UNION ALL

        SELECT
          'routine:' || p.proname || '(' ||
          pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' AS object_name
        FROM pg_catalog.pg_proc AS p
        JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_depend AS d
            WHERE d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
              AND d.objid = p.oid
              AND d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
              AND d.deptype = 'e'
          )
      ) AS public_objects
      ORDER BY object_name
    `);
    const tables = await client.query<TableRow>(`
      SELECT c.relname AS "table_name"
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_depend AS d
          WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
            AND d.objid = c.oid
            AND d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
            AND d.deptype = 'e'
        )
      ORDER BY c.relname
    `);
    const tableNames = tables.rows.map(({ table_name }) => table_name);
    const applicationTables = tableNames.filter(
      (tableName) => tableName !== '_prisma_migrations',
    );
    const appliedMigrations: string[] = [];

    if (
      migrationRelation.rows.length !== 1
      || typeof migrationRelation.rows[0].prisma_migrations_relation_exists !== 'boolean'
    ) {
      throw new Error('Catalog inspection returned an ambiguous result: migration table is ambiguous');
    }

    if (schema.rows.length !== 1 || schema.rows[0].public_schema_exists !== true) {
      throw new Error('Catalog inspection returned an ambiguous result: public schema is absent');
    }

    const applicationObjects = objects.rows.map(({ object_name }) => object_name);

    return {
      publicSchemaExists: true,
      prismaMigrationsRelationExists: migrationRelation.rows[0].prisma_migrations_relation_exists,
      applicationTables,
      applicationObjects,
      appliedMigrations,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export function runNativeCommand(
  command: string,
  args: readonly string[],
  databaseUrl: string,
): void {
  const isPrisma = command === 'npx' && args[0] === 'prisma';
  const executable = isPrisma ? process.execPath : command;
  const nativeArgs = isPrisma
    ? [require.resolve('prisma/build/index.js'), ...args.slice(1)]
    : [...args];
  execFileSync(executable, nativeArgs, {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
}

const productionDependencies: DeployFreshDatabaseDependencies = {
  prepareDatabase,
  inspectCatalog: inspectPostgresCatalog,
  runNative: runNativeCommand,
};

function isCatalogInspection(value: unknown): value is CatalogInspection {
  if (typeof value !== 'object' || value === null) return false;
  const inspection = value as Partial<CatalogInspection>;
  return inspection.publicSchemaExists !== true
    ? false
    : typeof inspection.prismaMigrationsRelationExists === 'boolean'
    && Array.isArray(inspection.applicationTables)
    && inspection.applicationTables.every((table) => typeof table === 'string')
    && Array.isArray(inspection.applicationObjects)
    && inspection.applicationObjects.every((object) => typeof object === 'string')
    && Array.isArray(inspection.appliedMigrations)
    && inspection.appliedMigrations.every((migration) => typeof migration === 'string');
}

export async function deployFreshDatabase(
  databaseUrl: string,
  deps: DeployFreshDatabaseDependencies = productionDependencies,
): Promise<void> {
  if (!databaseUrl.trim()) {
    throw new Error('DATABASE_URL is required for fresh-database deployment');
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }
  const configuredSchemas = targetUrl.searchParams.getAll('schema');
  if (configuredSchemas.length > 1) {
    throw new Error('Target DATABASE_URL must specify public schema exactly once or omit schema');
  }
  if (configuredSchemas.length === 1 && configuredSchemas[0] !== 'public') {
    throw new Error('Target DATABASE_URL must use the public schema');
  }

  await deps.prepareDatabase(databaseUrl);
  const inspection: unknown = await deps.inspectCatalog(databaseUrl);
  if (!isCatalogInspection(inspection)) {
    throw new Error('Catalog inspection returned an ambiguous result');
  }

  if (
    inspection.prismaMigrationsRelationExists
    || inspection.applicationTables.length !== 0
    || inspection.applicationObjects.length !== 0
    || inspection.appliedMigrations.length !== 0
  ) {
    throw new Error(
      'Refusing fresh-database deployment: target contains application objects or migration state',
    );
  }

  await deps.runNative(
    'npx',
    ['prisma', 'migrate', 'resolve', '--applied', BASELINE_MIGRATION],
    databaseUrl,
  );
  await deps.runNative('npx', ['prisma', 'migrate', 'deploy'], databaseUrl);
}

async function main(): Promise<void> {
  await deployFreshDatabase(process.env.DATABASE_URL ?? '');
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
