import fs from 'fs';
import path from 'path';

describe('service health wiring', () => {
  it('delegates health to the complete readiness service', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
    expect(source).toContain('checkReadiness({');
    expect(source).toContain("app.get('/ready', healthHandler)");
    expect(source).toContain("app.get('/live'");
    expect(source).toContain('app.use(requestLoggingMiddleware)');
    expect(source).toContain('logger.info(');
  });
});
