import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('deploys the proxy only on the approved custom domain', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));

  assert.equal(config.name, 'docai-custom-domain');
  assert.equal(config.main, 'src/index.mjs');
  assert.equal(config.workers_dev, false);
  assert.deepEqual(config.routes, [
    { pattern: 'docai.dpdns.org', custom_domain: true },
  ]);
});
