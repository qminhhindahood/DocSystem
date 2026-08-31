import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('ESLint generated-output boundary', () => {
  it.each([
    '.open-next/server-functions/default/handler.mjs',
    '.wrangler/tmp/dev-worker/worker.js',
  ])('ignores generated Worker artifact %s', async (path) => {
    const eslint = new ESLint({
      cwd: tmpdir(),
      overrideConfigFile: join(process.cwd(), 'eslint.config.mjs'),
    });
    await expect(eslint.isPathIgnored(path)).resolves.toBe(true);
  }, 30_000);
});
