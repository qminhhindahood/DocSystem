import fs from 'fs';
import path from 'path';

describe('backend worker wiring', () => {
  it('starts the durable ingestion worker and stops it during shutdown', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

    expect(source).toMatch(/createDefaultIngestionWorker\(\)/);
    expect(source).toMatch(/ingestionWorker\.start\(\)/);
    expect(source).toMatch(/ingestionWorker\?\.stop\(shutdownGraceMs\)/);
    expect(source).toMatch(/createDefaultTemplateCompilationWorker\(\)/);
    expect(source).toMatch(/templateCompilationWorker\?\.stop\(shutdownGraceMs\)/);
  });

  it('does not start the worker until the HTTP server has successfully bound', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
    const listenIndex = source.indexOf('await listenForReady()');
    const workerStartIndex = source.indexOf('ingestionWorker.start()');
    const templateWorkerStartIndex = source.indexOf('templateCompilationWorker.start()');

    expect(listenIndex).toBeGreaterThan(-1);
    expect(workerStartIndex).toBeGreaterThan(listenIndex);
    expect(templateWorkerStartIndex).toBeGreaterThan(listenIndex);
  });

  it('does not terminate the process before shutdown resources close', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
    expect(source).not.toContain('process.exit(');
    expect(source).toContain('closeRedis: () => redisClient.close()');
  });

  it('applies pending Prisma migrations before local development starts', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.predev).toBe('prisma migrate deploy');
  });

  it('keeps the production container startup free of database mutations', () => {
    const dockerfile = fs.readFileSync(path.join(__dirname, '../Dockerfile'), 'utf8');
    const command = dockerfile.match(/^CMD\s+(.+)$/m)?.[1] ?? '';

    expect(command).toBe('["node", "dist/index.js"]');
    expect(command).not.toMatch(/migrate|prepare_database|sh\s+-c/i);
  });

  it('orders migration preflight, deployment, and ownership verification explicitly', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.['deploy:migrate']).toBe(
      'node dist/scripts/prepare_database.js && prisma migrate deploy && node dist/scripts/assert_owner_integrity.js',
    );
    expect(packageJson.scripts?.['deploy:bootstrap']).toBe('node dist/scripts/bootstrap_user.js');
  });
});
