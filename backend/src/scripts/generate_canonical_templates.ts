import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DOCUMENT_TYPE_DEFINITIONS, DOCUMENT_TYPE_IDS } from '../constants/document-types';
import { generateDocumentDocx } from '../services/docx_service';
import { getTemplateContent } from '../services/template_service';
import { BACKEND_ROOT, PROJECT_ROOT } from './script_paths';

interface GeneratedEntry {
  docType: string;
  name: string;
  file: string;
  sha256: string;
  sizeBytes: number;
  source: 'canonical-registry';
  fidelity: 'baseline';
}

function resolveOutputDirectory(): string {
  const outIndex = process.argv.indexOf('--out');
  if (outIndex >= 0) {
    const value = process.argv[outIndex + 1];
    if (!value) throw new Error('--out requires a directory');
    return path.resolve(value);
  }
  const workspaceDocs = path.join(PROJECT_ROOT, 'docs');
  return fs.existsSync(workspaceDocs)
    ? path.join(workspaceDocs, 'generated-templates')
    : path.join(BACKEND_ROOT, 'generated-templates');
}

export async function generateCanonicalTemplates(outputDirectory = resolveOutputDirectory()): Promise<GeneratedEntry[]> {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const entries: GeneratedEntry[] = [];

  for (const docType of DOCUMENT_TYPE_IDS) {
    const definition = DOCUMENT_TYPE_DEFINITIONS[docType];
    const buffer = await generateDocumentDocx({
      docType,
      title: `Mau ${definition.name}`,
      content: getTemplateContent(docType),
    });
    const file = `${docType}.docx`;
    fs.writeFileSync(path.join(outputDirectory, file), buffer);
    entries.push({
      docType,
      name: definition.name,
      file,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      sizeBytes: buffer.length,
      source: 'canonical-registry',
      fidelity: 'baseline',
    });
  }

  fs.writeFileSync(path.join(outputDirectory, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    count: entries.length,
    warning: 'Baseline canonical templates; validate against an official editable DOCX before marking visual fidelity approved.',
    templates: entries,
  }, null, 2)}\n`);
  return entries;
}

if (require.main === module) {
  generateCanonicalTemplates()
    .then(entries => console.log(`Generated ${entries.length} canonical DOCX templates.`))
    .catch(error => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
