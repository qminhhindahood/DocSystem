import { afterEach, describe, expect, it } from 'vitest';
import { backendUrl } from '@/lib/server/backend';

describe('backendUrl runtime environment read (Cloudflare Pages, ticket 07)', () => {
  const original = process.env.BACKEND_API_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.BACKEND_API_URL;
    else process.env.BACKEND_API_URL = original;
  });

  it('reads BACKEND_API_URL lazily — set AFTER module load', () => {
    // On Cloudflare Workers the platform env vars land in process.env at
    // request time (adapter init.js populateProcessEnv), NOT at worker
    // startup. A module-load-time const would freeze to the localhost
    // fallback forever. The read must happen per call.
    process.env.BACKEND_API_URL = 'https://api.example.test';
    expect(backendUrl()).toBe('https://api.example.test');
  });

  it('picks up a changed value without re-import', () => {
    process.env.BACKEND_API_URL = 'https://api.first.test';
    expect(backendUrl()).toBe('https://api.first.test');
    process.env.BACKEND_API_URL = 'https://api.second.test';
    expect(backendUrl()).toBe('https://api.second.test');
  });

  it('falls back to localhost when unset', () => {
    delete process.env.BACKEND_API_URL;
    expect(backendUrl()).toBe('http://localhost:3001');
  });

  it('trims trailing slashes', () => {
    process.env.BACKEND_API_URL = 'https://api.example.test///';
    expect(backendUrl()).toBe('https://api.example.test');
  });
});
