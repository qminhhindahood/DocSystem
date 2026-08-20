import fs from 'fs';
import path from 'path';

describe('backend boot wiring (standalone conversion product)', () => {
  it('boots without master-stack background workers', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

    expect(source).not.toContain('ingestionWorker');
    expect(source).not.toContain('templateCompilationWorker');
    expect(source).not.toContain('createDefaultIngestionWorker');
    expect(source).not.toContain('createDefaultTemplateCompilationWorker');
  });

  it('mounts only the auth, convert, and BYOK settings route surfaces', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

    expect(source).toContain("app.use('/api/auth', authRoutes)");
    expect(source).toContain("app.use('/api/convert', convertRoutes)");
    expect(source).toContain("app.use('/api/settings/llm', llmSettingsRoutes)");
    for (const dead of ['qaRoutes', 'ragRoutes', 'workflowRoutes', 'templateRoutes', 'feedbackRoutes', 'documentsRoutes', 'documentProfileRoutes']) {
      expect(source).not.toContain(dead);
    }
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

  it('orders migration deployment and bootstrap explicitly', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.['deploy:migrate']).toBe('prisma migrate deploy');
    expect(packageJson.scripts?.['deploy:bootstrap']).toBe('node dist/scripts/bootstrap_user.js');
  });
});
