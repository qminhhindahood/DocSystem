import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DOCUMENT_TYPE_IDS } from '../constants/document-types';
import { generateCanonicalTemplates } from './generate_canonical_templates';

describe('generate canonical templates', () => {
  it('writes a valid DOCX and manifest entry for every registered type', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical-templates-'));
    try {
      const entries = await generateCanonicalTemplates(directory);
      expect(entries).toHaveLength(DOCUMENT_TYPE_IDS.length);
      for (const entry of entries) {
        const bytes = fs.readFileSync(path.join(directory, entry.file));
        expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304');
        expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
      }
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
      expect(manifest.count).toBe(30);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
