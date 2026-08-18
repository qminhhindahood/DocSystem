import fs from 'fs';
import path from 'path';

describe('API timeout wiring', () => {
  it('does not apply the 10-second fast timeout to LLM field extraction', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
    const policy = source.match(/const longRunningPaths = new Set\(\[(?<paths>[\s\S]*?)\]\);/);

    expect(policy?.groups?.paths).toContain("'/api/workflow/extract-fields'");
  });
});
