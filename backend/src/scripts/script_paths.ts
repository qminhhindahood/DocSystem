import fs from 'node:fs';
import path from 'node:path';

export const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
export const PROJECT_ROOT = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : path.resolve(BACKEND_ROOT, '..');

const workspaceResults = path.join(PROJECT_ROOT, 'docs', 'rag-results');

export const RAG_RESULTS_DIR = process.env.RAG_RESULTS_DIR
  ? path.resolve(process.env.RAG_RESULTS_DIR)
  : fs.existsSync(path.join(PROJECT_ROOT, 'docs'))
    ? workspaceResults
    : path.join(BACKEND_ROOT, 'reports');

export const REINDEX_MANIFEST_PATH = process.env.REINDEX_MANIFEST_PATH
  ? path.resolve(process.env.REINDEX_MANIFEST_PATH)
  : path.join(BACKEND_ROOT, '.reindex-manifest.json');

export const DEFAULT_EVAL_FIXTURES_PATH = path.join(BACKEND_ROOT, 'config', 'rag-evaluation-fixtures.json');
