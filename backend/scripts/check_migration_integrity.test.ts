import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const backendRoot = join(__dirname, '..');
const repoRoot = join(backendRoot, '..');
const migrationsRoot = join(backendRoot, 'prisma', 'migrations');

const read = (...segments: string[]) => readFileSync(join(...segments), 'utf8');

describe('squashed standalone migration baseline (ADR-0001)', () => {
  it('contains exactly one migration creating only User, PasswordResetToken, and UserLLMConfig', () => {
    const migrations = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(migrations).toEqual(['20260901000000_init_standalone_auth']);

    const sql = read(migrationsRoot, migrations[0], 'migration.sql');
    const tables = [...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]).sort();
    expect(tables).toEqual(['PasswordResetToken', 'User', 'UserLLMConfig']);

    for (const dead of ['Document', 'Chunk', 'Feedback', 'Template', 'IngestionJob', 'TrainingJob', 'ModelVersion', 'UserDocumentProfile']) {
      expect(sql).not.toContain(`"${dead}"`);
    }
    expect(sql).not.toMatch(/vector/i);
  });

  it('schema.prisma defines only the three standalone models and no pgvector extension', () => {
    const schema = read(backendRoot, 'prisma', 'schema.prisma');
    const models = [...schema.matchAll(/^model\s+(\w+)\s+{/gm)].map((m) => m[1]).sort();

    expect(models).toEqual(['PasswordResetToken', 'User', 'UserLLMConfig']);
    expect(schema).not.toContain('extensions');
    expect(schema).not.toContain('vector');
    expect(schema).not.toContain('postgresqlExtensions');
  });

  it('compose uses plain postgres:15-alpine and init.sql creates no extensions', () => {
    const compose = read(repoRoot, 'docker-compose.yml');
    const initSql = read(repoRoot, 'init.sql');

    expect(compose).toContain('image: postgres:15-alpine');
    expect(compose).not.toContain('pgvector');
    expect(initSql).not.toMatch(/CREATE EXTENSION/i);
  });

  it('the compose migrate service applies the single migration without pgvector bootstrapping', () => {
    const compose = read(repoRoot, 'docker-compose.yml');

    expect(compose).toContain('prisma migrate deploy');
    expect(compose).not.toContain('prepare_database');
    expect(compose).not.toContain('CREATE EXTENSION');
  });

  it('the backend carries no pgvector/HNSW wiring', () => {
    const packageJson = JSON.parse(read(backendRoot, 'package.json')) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies).not.toHaveProperty('pgvector');
    expect(packageJson.dependencies).not.toHaveProperty('pg');
  });
});
