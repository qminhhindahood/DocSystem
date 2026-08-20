import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const exists = (path: string) => existsSync(resolve(root, path));
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('removed master-stack frontend surfaces (standalone prune, ticket 06)', () => {
  it.each([
    'app/(app)/dashboard',
    'app/(app)/documents',
    'app/(app)/generate',
    'app/(app)/qa',
    'app/(app)/templates',
  ])('page %s is deleted', (page) => {
    expect(exists(page)).toBe(false);
  });

  it.each([
    'components/DocumentCard.tsx',
    'components/DocumentDetailModal.tsx',
    'components/DocumentDiffViewer.tsx',
    'components/DocumentEditor.tsx',
    'components/StreamingDocumentEditor.tsx',
    'components/TemplatePreviewModal.tsx',
    'components/analytics',
    'components/documents',
    'components/feature',
    'components/settings',
    'components/templates',
  ])('component %s is deleted', (component) => {
    expect(exists(component)).toBe(false);
  });

  it.each([
    'lib/api.ts',
    'lib/analytics.ts',
    'lib/document-types.ts',
    'lib/llm-providers.ts',
    'lib/settings-api.ts',
    'lib/sse.ts',
    'lib/templates-api.ts',
    'lib/use-debounced-value.ts',
    'lib/constants/editor.ts',
    'lib/server/cloud-run-auth.ts',
  ])('client %s is deleted', (client) => {
    expect(exists(client)).toBe(false);
  });

  it('keeps the convert page, auth pages, and landing', () => {
    expect(exists('app/(app)/convert/page.tsx')).toBe(true);
    expect(exists('app/(auth)/login/page.tsx')).toBe(true);
    expect(exists('app/(auth)/signup/page.tsx')).toBe(true);
    expect(exists('app/(auth)/forgot-password/page.tsx')).toBe(true);
    expect(exists('app/(auth)/reset-password/page.tsx')).toBe(true);
    expect(exists('app/page.tsx')).toBe(true);
  });

  it('navigation lists only the convert surface', () => {
    const routes = read('lib/constants/routes.ts');
    expect(routes).toContain("href: '/convert'");
    for (const dead of ['/dashboard', '/generate', '/documents', '/templates', '/qa']) {
      expect(routes).not.toContain(`href: '${dead}'`);
    }
  });

  it('the proxy allowlist permits only health and convert paths', () => {
    const proxy = read('app/api/proxy/[...path]/route.ts');
    expect(proxy).toContain('/^convert$/');
    expect(proxy).toContain('/^convert\\/bulk$/');
    for (const dead of ['workflow', 'feedback', 'rag', 'qa', 'documents', 'templates', 'settings']) {
      expect(proxy).not.toMatch(new RegExp(`pattern: /\\^${dead}`));
    }
  });
});
