import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('editor theme integration', () => {
  it('passes the active application theme to the streaming editor', () => {
    const source = read('components/StreamingDocumentEditor.tsx');

    expect(source).toContain("import { useTheme } from '@/lib/theme'");
    expect(source).toMatch(/const \{ theme \} = useTheme\(\)/);
    expect(source).toContain('theme={theme}');
    expect(source).not.toContain('theme="light"');
  });

  it('keeps Monaco light and dark mappings explicit', () => {
    expect(read('components/DocumentEditor.tsx')).toContain('theme === "light" ? "vs" : "vs-dark"');
    expect(read('components/DocumentDiffViewer.tsx')).toContain('theme === "light" ? "vs" : "vs-dark"');
  });
});
