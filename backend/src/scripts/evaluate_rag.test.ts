import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { selectEvaluationEvidence } from '../services/context_packer';
import type { ContextChunk } from '../services/context_packer';
import { evaluationDocumentType, loadEvaluationCases, writeEvaluationReport } from './evaluate_rag';
import type { EvaluationReport } from './evaluate_rag';

const summary = (id: string): ContextChunk => ({
  id, documentId: 'd1', level: 0, isSummary: true, content: 'Tóm tắt.',
});
const evidence = (id: string): ContextChunk => ({
  id, documentId: 'd1', level: 1, content: 'Nội dung.',
});

describe('RAG evaluation evidence selection', () => {
  it('selectEvaluationEvidence filters summaries before taking topK', () => {
    const result = selectEvaluationEvidence(
      [summary('s1'), evidence('e1'), summary('s2'), evidence('e2')],
      2,
    );
    expect(result.map((c) => c.id)).toEqual(['e1', 'e2']);
  });

  it('returns fewer than K when insufficient evidence exists', () => {
    expect(selectEvaluationEvidence([summary('s1')], 5)).toEqual([]);
  });

  it('returns at most topK chunks', () => {
    expect(
      selectEvaluationEvidence([evidence('e1'), evidence('e2'), evidence('e3')], 2).map((c) => c.id),
    ).toEqual(['e1', 'e2']);
  });
});

describe('RAG evaluation report persistence', () => {
  it('writes a machine-readable failed report with the external requirement', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-eval-report-'));
    const reportPath = path.join(directory, 'failure.json');
    const report: EvaluationReport = {
      schemaVersion: 1,
      status: 'failed',
      startedAt: '2026-01-01T00:00:00.000Z',
      evaluatedAt: '2026-01-01T00:00:01.000Z',
      reportPath,
      topK: 5,
      featureFlags: {},
      build: { scriptSha256: 'abc', nodeVersion: process.version },
      corpus: { available: false, error: 'database unavailable' },
      failure: {
        stage: 'corpus-preflight',
        reason: 'database unavailable',
        externalRequirement: 'A reachable database is required.',
      },
      results: [],
    };

    try {
      writeEvaluationReport(report);
      expect(JSON.parse(fs.readFileSync(reportPath, 'utf8'))).toEqual(report);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('RAG evaluation fixtures', () => {
  it('uses canonical document-type filters but leaves reference-only categories global', () => {
    expect(evaluationDocumentType({ docType: 'cong-van' })).toBe('cong-van');
    expect(evaluationDocumentType({ docType: 'nghi-dinh-reference' })).toBeUndefined();
    expect(evaluationDocumentType({})).toBeUndefined();
  });

  it('loads source-bound fixtures from a versioned external file', () => {
    const fixtures = loadEvaluationCases(path.resolve(__dirname, '..', '..', 'config', 'rag-evaluation-fixtures.json'));
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
    expect(fixtures.every(fixture => Array.isArray(fixture.expectedKeywords))).toBe(true);
    expect(fixtures.some(fixture => fixture.expectedSourceFiles?.length)).toBe(true);
  });

  it('rejects duplicate fixture IDs', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-eval-fixtures-'));
    const fixturePath = path.join(directory, 'fixtures.json');
    fs.writeFileSync(fixturePath, JSON.stringify({
      schemaVersion: 1,
      cases: [
        { id: 'duplicate', query: 'one', expectedKeywords: [] },
        { id: 'duplicate', query: 'two', expectedKeywords: [] },
      ],
    }));
    try {
      expect(() => loadEvaluationCases(fixturePath)).toThrow('Duplicate evaluation fixture id');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
