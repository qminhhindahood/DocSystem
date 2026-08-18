import 'dotenv/config';
import { Client } from 'pg';

const required: Array<[string, string]> = [
  ['Chunk', 'isSummary'],
  ['Chunk', 'summaryOf'],
  ['Document', 'ingestionStatus'],
  ['Document', 'storageKey'],
];

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const history = await client.query(`SELECT to_regclass('public."_prisma_migrations"') AS table_name`);
    if (!history.rows[0]?.table_name) {
      throw new Error('No Prisma migration history found; back up the database and adopt it explicitly before migrating.');
    }
    const missing: string[] = [];
    for (const [table, column] of required) {
      const result = await client.query(
        'SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3',
        ['public', table, column],
      );
      if (result.rowCount === 0) missing.push(`${table}.${column}`);
    }
    if (missing.length) throw new Error(`Database is missing required columns: ${missing.join(', ')}. Back up and adopt explicitly.`);
    console.log('Prisma adoption preflight passed.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
