import { execFileSync } from 'node:child_process';
import 'dotenv/config';

type ExtensionRow = { extversion: string; vector_type: string | null };
type FreshRow = { is_fresh: boolean };
type QueryResult<T> = { rows: T[] };
type PgClient = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query<T = unknown>(sql: string): Promise<QueryResult<T>>;
};
const { Client } = require('pg') as {
  Client: new (options: Record<string, unknown>) => PgClient;
};

export const BASELINE_MIGRATION = '20250608000000_rename_ollama_to_lmstudio';

export async function prepareDatabase(databaseUrl: string): Promise<string> {
  if (!databaseUrl.trim()) {
    throw new Error('DATABASE_URL is required before database preparation');
  }

  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    const result = await client.query<ExtensionRow>(`
      SELECT e.extversion, pg_catalog.to_regtype('vector')::text AS vector_type
      FROM pg_catalog.pg_extension AS e
      WHERE e.extname = 'vector'
    `);
    const extension = result.rows[0];
    if (!extension || extension.vector_type !== 'vector') {
      throw new Error('pgvector verification failed: extension or vector type is unavailable');
    }
    return extension.extversion;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Database preparation failed: ${detail}. Install/enable pgvector and grant the deployment role permission to use it.`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function baselineFreshDatabase(databaseUrl: string): Promise<boolean> {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    const result = await client.query<FreshRow>(`
      SELECT NOT (
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS c
          JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_depend AS d
              WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
                AND d.objid = c.oid
                AND d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
                AND d.deptype = 'e'
            )
        )
        OR EXISTS (
          SELECT 1
          FROM pg_catalog.pg_type AS t
          JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public' AND t.typrelid = 0 AND t.typelem = 0
            AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_depend AS d
              WHERE d.classid = 'pg_catalog.pg_type'::pg_catalog.regclass
                AND d.objid = t.oid
                AND d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
                AND d.deptype = 'e'
            )
        )
        OR EXISTS (
          SELECT 1
          FROM pg_catalog.pg_proc AS p
          JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_depend AS d
              WHERE d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
                AND d.objid = p.oid
                AND d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
                AND d.deptype = 'e'
            )
        )
      ) AS is_fresh
    `);
    if (result.rows.length !== 1 || typeof result.rows[0].is_fresh !== 'boolean') {
      throw new Error('Database freshness inspection returned an ambiguous result');
    }
    if (!result.rows[0].is_fresh) return false;
  } finally {
    await client.end().catch(() => undefined);
  }

  execFileSync(
    'prisma',
    ['migrate', 'resolve', '--applied', BASELINE_MIGRATION],
    { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'inherit' },
  );
  return true;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const version = await prepareDatabase(databaseUrl);
  const baselined = await baselineFreshDatabase(databaseUrl);
  console.log(
    `pgvector ${version} is installed and verified; database is ${baselined ? 'fresh and explicitly baselined' : 'existing'}.`,
  );
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
