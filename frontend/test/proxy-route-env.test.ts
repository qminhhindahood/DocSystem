import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Ticket 07: on Cloudflare Workers, process.env platform vars land at request
// time (adapter init populateProcessEnv), not at worker startup. Any route
// module that captures process.env.BACKEND_API_URL into a module const would
// freeze to the localhost fallback and every proxied request would 502 in
// production. This contract forbids that shape in the proxy route source.
const backendHelper = readFileSync(
  join(process.cwd(), 'lib', 'server', 'backend.ts'),
  'utf8',
);
const proxyRoute = readFileSync(
  join(process.cwd(), 'app', 'api', 'proxy', '[...path]', 'route.ts'),
  'utf8',
);

describe('proxy route runtime env read (Cloudflare Workers, ticket 07)', () => {
  it('backend.ts never captures BACKEND_API_URL at module load', () => {
    // A top-level const initialized from process.env is the frozen shape.
    expect(backendHelper).not.toMatch(
      /^\s*const\s+\w+\s*=\s*process\.env\./m,
    );
  });

  it('proxy route never captures BACKEND_API_URL at module load', () => {
    expect(proxyRoute).not.toMatch(
      /^\s*const\s+\w+\s*=\s*process\.env\./m,
    );
  });

  it('proxy route uses backendUrl() from the helper, not its own read', () => {
    expect(proxyRoute).toMatch(/import\s*\{[^}]*backendUrl[^}]*\}\s*from\s*'@\/lib\/server\/backend'/);
    expect(proxyRoute).toMatch(/backendUrl\(\)/);
  });
});
