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
    'components/templates',
  ])('component %s is deleted', (component) => {
    expect(exists(component)).toBe(false);
  });

  it.each([
    // BYOK settings were re-added (dialog only); the master-stack settings
    // surfaces stay dead.
    'components/settings/DocumentDefaultsForm.tsx',
    'components/settings/DocumentProfileForm.tsx',
    'components/settings/LLMSettingsForm.tsx',
  ])('dead master settings surface %s stays deleted', (component) => {
    expect(exists(component)).toBe(false);
  });

  it('OpenRouter picker and catalog client stay deleted', () => {
    expect(exists('components/settings/OpenRouterModelPicker.tsx')).toBe(false);
    expect(read('lib/settings-api.ts')).not.toContain('getOpenRouterModels');
    expect(read('lib/llm-providers.ts')).not.toContain('openrouter');
  });

  it('Q&A types and active design guidance stay deleted', () => {
    const apiTypes = read('types/api.ts');
    const activeDesign = read('docs/superpowers/specs/2026-08-08-rounded-civic-workspace-design.md');
    for (const remnant of ['QASource', 'QAMessage', 'QAAnswer']) {
      expect(apiTypes).not.toContain(remnant);
    }
    expect(activeDesign).not.toMatch(/Question Answering|Q&A/);
  });

  it.each([
    'lib/api.ts',
    'lib/analytics.ts',
    'lib/document-types.ts',
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

  it('the proxy allowlist permits only health, convert, and BYOK settings paths', () => {
    const proxy = read('app/api/proxy/[...path]/route.ts');
    expect(proxy).toContain('/^convert$/');
    expect(proxy).toContain('/^convert\\/bulk$/');
    expect(proxy).toContain('/^settings\\/llm$/');
    for (const dead of ['workflow', 'feedback', 'rag', 'qa', 'documents', 'templates']) {
      expect(proxy).not.toMatch(new RegExp(`pattern: /\\^${dead}`));
    }
    // Only the llm settings subtree is proxied — no document-profile etc.
    expect(proxy).not.toContain('settings\\/document-profile');
  });
});
