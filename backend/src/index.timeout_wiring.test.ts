import fs from 'fs';
import path from 'path';

describe('API timeout wiring', () => {
  it('exempts the conversion upload path from the fast timeout', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
    const policy = source.match(/const longRunningPaths = new Set\(\[(?<paths>[\s\S]*?)\]\);/);

    expect(policy?.groups?.paths).toContain("'/api/convert'");
  });

  it('does not exempt removed master-stack endpoints', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
    expect(source).not.toContain('/api/workflow/');
    expect(source).not.toContain('/api/qa/');
  });
});
