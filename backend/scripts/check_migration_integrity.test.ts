import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SYSTEM_OWNER_ID = '00000000-0000-0000-0000-000000000001';
const migrationsRoot = 'backend/prisma/migrations';
const schemaSupportingMigrations = [
  '20260709000000_add_summary_chunks',
  '20260711000000_rename_ollama_to_lmstudio_after_init',
  '20260712000000_add_document_ownership',
  '20260712010000_add_rag_reliability_metadata',
];
const templateMigration = '20260712184012_init_dynamic_templates';
const templateRepairMigration = '20260718090000_repair_dynamic_template_schema';
const templateLegacyConstraintRepairMigration = '20260718100000_release_legacy_template_insert_constraints';
const ingestionJobsMigration = '20260720000000_add_ingestion_jobs';
const documentProfileExpansionMigration = '20260727000000_expand_document_profiles';
const passwordRecoveryMigration = '20260809000000_add_password_recovery';
const preInitRenameMigration = '20250608000000_rename_ollama_to_lmstudio';
const initMigration = '20260513195302_init';
const publishedMigrationSha256 = {
  'backend/prisma/migrations/20250608000000_rename_ollama_to_lmstudio/migration.sql':
    'ffcb5ada5eb9a31fc1df5a7339d6e00fd648b56fde0fdabe96c0216005e4434e',
  'backend/prisma/migrations/20260513195302_init/migration.sql':
    '0b9458dfd1ee2783e0e1f083e420e2a15f67a13d17568aca7be4b42d4d91b476',
} as const;
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const migrationSql = (migration: string) => readFileSync(
  join(repoRoot, migrationsRoot, migration, 'migration.sql'),
  'utf8',
);

test.each(Object.entries(publishedMigrationSha256))(
  '%s is byte-identical to the published migration',
  (file, expectedSha256) => {
    expect(sha(readFileSync(join(repoRoot, file)))).toBe(expectedSha256);
  },
);

test.each(schemaSupportingMigrations)('%s is present in tracked migration history', (migration) => {
  const path = `${migrationsRoot}/${migration}/migration.sql`;
  expect(() => execFileSync('git', ['ls-files', '--error-unmatch', path], {
    cwd: repoRoot,
    stdio: 'pipe',
  })).not.toThrow();
});

test('schema-supporting migrations precede the template migration in chronological order', () => {
  const migrations = readdirSync(join(repoRoot, migrationsRoot)).sort();
  const expectedOrder = [...schemaSupportingMigrations, templateMigration];
  const actualOrder = migrations.filter((migration) => expectedOrder.includes(migration));

  expect(actualOrder).toEqual(expectedOrder);
});

test('the immutable pre-init rename is baselined only after a fail-closed empty-target check', () => {
  expect(preInitRenameMigration < initMigration).toBe(true);

  const helper = readFileSync(
    join(repoRoot, 'backend/scripts/deploy_fresh_database.ts'),
    'utf8',
  );
  const runtimePreparation = readFileSync(
    join(repoRoot, 'backend/src/scripts/prepare_database.ts'),
    'utf8',
  );
  const packageJson = JSON.parse(
    readFileSync(join(repoRoot, 'backend/package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };

  expect(helper).toContain(
    "export const BASELINE_MIGRATION = '20250608000000_rename_ollama_to_lmstudio';",
  );
  expect(helper).toMatch(
    /\['prisma', 'migrate', 'resolve', '--applied', BASELINE_MIGRATION\]/,
  );
  expect(helper).toContain('await deps.prepareDatabase(databaseUrl);');
  expect(helper).toMatch(/applicationTables\.length !== 0/);
  expect(helper).toMatch(/appliedMigrations\.length !== 0/);
  expect(helper).toMatch(/publicSchemaExists !== true/);
  expect(runtimePreparation).toContain(`export const BASELINE_MIGRATION = '${preInitRenameMigration}';`);
  expect(runtimePreparation).toContain('SELECT NOT (');
  expect(runtimePreparation).toContain('pg_catalog.pg_depend');
  expect(runtimePreparation).toMatch(/\['migrate', 'resolve', '--applied', BASELINE_MIGRATION\]/);
  expect(packageJson.scripts?.['prisma:deploy:fresh']).toBe(
    'tsx scripts/deploy_fresh_database.ts',
  );
});

test('document ownership establishes isDisabled, the exact owner default, and the foreign key', () => {
  const sql = migrationSql('20260712000000_add_document_ownership');

  expect(sql).toContain(
    'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isDisabled" BOOLEAN NOT NULL DEFAULT false;',
  );
  expect(sql).toContain(`VALUES ('${SYSTEM_OWNER_ID}', 'system-owner'`);
  expect(sql).toContain('ON CONFLICT ("id") DO UPDATE SET "isDisabled" = true;');
  expect(sql).toContain(
    `ALTER TABLE "Document" ALTER COLUMN "ownerId" SET DEFAULT '${SYSTEM_OWNER_ID}';`,
  );
  expect(sql).toContain(
    'FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
  );
  expect('20260712000000_add_document_ownership' < templateMigration).toBe(true);
});

test('template adoption is additive and preserves the exact system-owner default', () => {
  const sql = migrationSql(templateMigration);
  expect(sql).not.toMatch(/DROP COLUMN\s+"(?:header|signatureBlock)"/i);
  expect(sql).not.toMatch(/ALTER COLUMN\s+"ownerId"\s+DROP DEFAULT/i);
  expect(sql).toContain('DROP INDEX IF EXISTS "Template_docType_key"');
  expect(sql).toContain('ALTER COLUMN "ownerId" SET NOT NULL');
  expect(sql).toContain(`ALTER COLUMN "ownerId" SET DEFAULT '${SYSTEM_OWNER_ID}'`);
  expect(sql).toContain('ALTER COLUMN "status" SET DEFAULT \'REJECTED\'');
});

test('dynamic template repair is additive and backfills ownership', () => {
  const sql = migrationSql(templateRepairMigration);
  expect(sql).toContain('ADD COLUMN IF NOT EXISTS "header" TEXT NOT NULL DEFAULT \'\'');
  expect(sql).toContain('ADD COLUMN IF NOT EXISTS "signatureBlock" TEXT NOT NULL DEFAULT \'\'');
  expect(sql).toContain('ADD COLUMN IF NOT EXISTS "status" "TemplateStatus"');
  expect(sql).toContain(`SET "ownerId" = '${SYSTEM_OWNER_ID}'`);
  expect(sql).toContain('ALTER COLUMN "docType" DROP NOT NULL');
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS "UserDocumentProfile"');
  expect(sql).not.toMatch(/DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM\s+"Template"/i);
});

test('legacy template columns remain preserved without blocking dynamic inserts', () => {
  const sql = migrationSql(templateLegacyConstraintRepairMigration);

  expect(sql).toContain('ALTER COLUMN "filePath" DROP NOT NULL');
  expect(sql).toContain('ALTER COLUMN "schema" DROP NOT NULL');
  expect(sql).not.toMatch(/DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM\s+"Template"/i);
});

test('ingestion jobs add a durable leased queue without destructive schema changes', () => {
  const sql = migrationSql(ingestionJobsMigration);

  expect(sql).toContain('CREATE TABLE "IngestionJob"');
  expect(sql).toContain('CONSTRAINT "IngestionJob_documentId_key" UNIQUE ("documentId")');
  expect(sql).toContain(
    'FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE',
  );
  expect(sql).toContain('CREATE INDEX "IngestionJob_status_availableAt_idx"');
  expect(sql).toContain('CREATE INDEX "IngestionJob_leaseExpiresAt_idx"');
  expect(sql).not.toMatch(/DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM/i);
});

test('document profile expansion is additive and covers organization contact fields', () => {
  const sql = migrationSql(documentProfileExpansionMigration);
  for (const column of [
    'supervisingAgency', 'agencyAddress', 'agencyEmail', 'agencyWebsite', 'agencyPhone',
  ]) {
    expect(sql).toContain(`ADD COLUMN IF NOT EXISTS "${column}" TEXT`);
  }
  expect(sql).not.toMatch(/DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM/i);
});

test('password recovery is additive, revokes sessions, and stores only token hashes', () => {
  const sql = migrationSql(passwordRecoveryMigration);
  const schema = readFileSync(join(repoRoot, 'backend/prisma/schema.prisma'), 'utf8');

  expect(schema).toMatch(/^\s*email\s+String\?\s+@unique\s*$/m);
  expect(schema).toMatch(/^\s*sessionVersion\s+Int\s+@default\(0\)\s*$/m);
  expect(schema).toMatch(/^\s*resetTokens\s+PasswordResetToken\[\]\s*$/m);
  expect(schema).toMatch(/^\s*tokenHash\s+String\s+@unique\s*$/m);
  expect(schema).toMatch(/^\s*usedAt\s+DateTime\?\s*$/m);
  expect(schema).toContain('@@index([userId, createdAt])');
  expect(schema).toContain('@@index([expiresAt])');
  expect(sql).toContain('ADD COLUMN IF NOT EXISTS "email" TEXT');
  expect(sql).toContain('ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0');
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS "PasswordResetToken"');
  expect(sql).toContain('UNIQUE ("tokenHash")');
  expect(sql).toContain('ON DELETE CASCADE ON UPDATE CASCADE');
  expect(sql).not.toMatch(/DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM/i);
});
