import { Client } from 'pg';

const SYSTEM_OWNER_ID = '00000000-0000-0000-0000-000000000001';

interface Assertion {
  name: string;
  sql: string;
  expected: unknown;
  transform?: (row: Record<string, unknown>) => unknown;
}

const assertions: Assertion[] = [
  {
    name: 'No Document rows with NULL ownerId',
    sql: `SELECT COUNT(*) AS cnt FROM "Document" WHERE "ownerId" IS NULL`,
    expected: '0',
    transform: (r) => r.cnt,
  },
  {
    name: 'No Template rows with NULL ownerId',
    sql: `SELECT COUNT(*) AS cnt FROM "Template" WHERE "ownerId" IS NULL`,
    expected: '0',
    transform: (r) => r.cnt,
  },
  {
    name: `System-owner user (${SYSTEM_OWNER_ID}) exists and is disabled`,
    sql: `SELECT COUNT(*) AS cnt FROM "User" WHERE "id" = '${SYSTEM_OWNER_ID}' AND "isDisabled" = true`,
    expected: '1',
    transform: (r) => r.cnt,
  },
  {
    name: 'Document.ownerId has system-owner default',
    sql: `SELECT column_default AS val FROM information_schema.columns WHERE table_name = 'Document' AND column_name = 'ownerId'`,
    expected: SYSTEM_OWNER_ID,
    transform: (r) => {
      const raw = r.val as string | null;
      if (!raw) return null;
      // Strip ::text cast or single-quote wrapping
      return raw.replace(/::text$/, '').replace(/'/g, '').trim();
    },
  },
  {
    name: 'Template.ownerId has system-owner default',
    sql: `SELECT column_default AS val FROM information_schema.columns WHERE table_name = 'Template' AND column_name = 'ownerId'`,
    expected: SYSTEM_OWNER_ID,
    transform: (r) => {
      const raw = r.val as string | null;
      if (!raw) return null;
      return raw.replace(/::text$/, '').replace(/'/g, '').trim();
    },
  },
  {
    name: 'Template.status has REJECTED default',
    sql: `SELECT column_default AS val FROM information_schema.columns WHERE table_name = 'Template' AND column_name = 'status'`,
    expected: 'REJECTED',
    transform: (r) => {
      const raw = r.val as string | null;
      if (!raw) return null;
      return raw.replace(/::"TemplateStatus"$/, '').replace(/'/g, '').trim();
    },
  },
];

export async function assertOwnerIntegrity(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  const failures: string[] = [];

  try {
    await client.connect();

    for (const assertion of assertions) {
      const result = await client.query(assertion.sql);
      const row = result.rows[0] as Record<string, unknown> | undefined;
      const actual = row && assertion.transform ? assertion.transform(row) : null;
      if (actual !== assertion.expected) {
        failures.push(
          `  FAIL  ${assertion.name}\n` +
          `         Expected: ${String(assertion.expected)}, Got: ${String(actual)}`,
        );
      } else {
        console.log(`  PASS  ${assertion.name}`);
      }
    }
  } finally {
    await client.end().catch(() => undefined);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} assertion(s) failed:\n`);
    for (const f of failures) console.error(f);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const urlIndex = args.indexOf('--database-url');
  if (urlIndex === -1 || urlIndex + 1 >= args.length) {
    console.error('Usage: assert_owner_integrity.ts --database-url <postgresql://...>');
    process.exitCode = 1;
    return;
  }
  const databaseUrl = args[urlIndex + 1];
  await assertOwnerIntegrity(databaseUrl);
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
