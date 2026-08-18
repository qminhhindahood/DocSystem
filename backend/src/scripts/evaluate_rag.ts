/**
 * RAG Evaluation Script
 *
 * Measures retrieval quality (Recall@K, MRR) before and after system upgrades.
 * Run with: npx tsx src/scripts/evaluate_rag.ts
 *
 * Prerequisites: PostgreSQL + embeddings service running, at least some
 * indexed documents in the database.
 */

import { ragService } from '../services/rag_service';
import { getLLMConfig, callLLM } from '../services/llm_config_service';
import { checkFaithfulness, checkAnswerRelevancy } from '../services/context_filter';
import { retrieveWithQuality } from '../services/self_correct';
import { selectEvaluationEvidence } from '../services/context_packer';
import { SYSTEM_ACCESS } from '../utils/document_access';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { prisma } from '../utils/prisma';
import { isDocumentTypeId } from '../constants/document-types';
import {
  DEFAULT_EVAL_FIXTURES_PATH,
  PROJECT_ROOT,
  RAG_RESULTS_DIR,
  REINDEX_MANIFEST_PATH,
} from './script_paths';

const EVAL_GENERATE = process.env.EVAL_GENERATE === 'true';
const DEFAULT_RESULTS_PATH = path.join(RAG_RESULTS_DIR, 'evaluation-latest.json');

// ─── Test Cases ─────────────────────────────────────────────────────────────
// Each case has a query and a set of keywords that MUST appear in at least one
// retrieved chunk for the retrieval to be counted as a hit.

export interface EvalCase {
  id: string;
  query: string;
  /** At least one retrieved chunk must contain ALL of these substrings (case-insensitive) */
  expectedKeywords: string[];
  /** Optional: the chunk must be at this hierarchical level */
  expectedLevel?: number;
  /** Preferred gold labels for production evals; keyword fallback is legacy only. */
  expectedDocumentIds?: string[];
  expectedChunkIds?: string[];
  expectedNoAnswer?: boolean;
  /** Stable source filenames resolved through the reindex manifest at runtime. */
  expectedSourceFiles?: string[];
  category?: string;
  docType?: string;
}

export function evaluationDocumentType(evalCase: Pick<EvalCase, 'docType'>): string | undefined {
  return evalCase.docType && isDocumentTypeId(evalCase.docType) ? evalCase.docType : undefined;
}

export function loadEvaluationCases(fixturesPath = process.env.EVAL_FIXTURES_PATH || DEFAULT_EVAL_FIXTURES_PATH): EvalCase[] {
  const parsed = JSON.parse(fs.readFileSync(path.resolve(fixturesPath), 'utf8')) as {
    schemaVersion?: number;
    cases?: EvalCase[];
  };
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    throw new Error(`Invalid evaluation fixture file: ${fixturesPath}`);
  }
  const ids = new Set<string>();
  for (const fixture of parsed.cases) {
    if (!fixture.id?.trim() || !fixture.query?.trim() || !Array.isArray(fixture.expectedKeywords)) {
      throw new Error(`Invalid evaluation fixture entry in ${fixturesPath}`);
    }
    if (ids.has(fixture.id)) throw new Error(`Duplicate evaluation fixture id: ${fixture.id}`);
    ids.add(fixture.id);
  }
  return parsed.cases;
}

export function resolveEligibleCases(
  cases: EvalCase[],
  corpusDocumentIds: string[],
): { eligible: EvalCase[]; skipped: Array<{ id: string; reason: string }> } {
  let manifest: Record<string, { docId: string; file: string }> = {};
  try {
    manifest = JSON.parse(fs.readFileSync(REINDEX_MANIFEST_PATH, 'utf8'));
  } catch {
    // Source-bound cases below receive an explicit skip reason.
  }
  const entries = Object.values(manifest);
  const corpusIds = new Set(corpusDocumentIds);
  const eligible: EvalCase[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const fixture of cases) {
    if (!fixture.expectedSourceFiles?.length) {
      eligible.push(fixture);
      continue;
    }
    const resolvedIds = fixture.expectedSourceFiles
      .map(file => entries.find(entry => entry.file === file)?.docId)
      .filter((id): id is string => typeof id === 'string' && corpusIds.has(id));
    if (resolvedIds.length === 0) {
      skipped.push({ id: fixture.id, reason: 'Required source file is not present in the active reindex manifest and corpus.' });
      continue;
    }
    eligible.push({ ...fixture, expectedDocumentIds: [...new Set(resolvedIds)] });
  }
  return { eligible, skipped };
}

// ─── Metrics ────────────────────────────────────────────────────────────────

interface EvalResult {
  id: string;
  query: string;
  hit: boolean;
  rank: number | null; // 1-indexed rank of first hit, null if miss
  retrievedCount: number;
  faithfulness?: number; // Task D: 0..1 groundedness of generated answer
  answerRelevancy?: number; // Task D: 0..1 answerability from context
  latencyMs: number;
  retrievedChunkIds: string[];
  retrievedDocumentIds: string[];
  contextPrecision?: number;
  error?: string;
}

export interface EvaluationReport {
  schemaVersion: 1;
  status: 'running' | 'success' | 'failed';
  failure?: { stage: string; reason: string; externalRequirement: string };
  startedAt: string;
  evaluatedAt: string;
  reportPath: string;
  topK: number;
  featureFlags: Record<string, boolean | string | undefined>;
  build: {
    scriptSha256: string;
    gitCommit?: string;
    nodeVersion: string;
    reindexManifestSha256?: string;
    latestReindexReportSha256?: string;
  };
  corpus: {
    available: boolean;
    documentCount?: number;
    chunkCount?: number;
    summaryChunkCount?: number;
    documentsByType?: Record<string, number>;
    chunksByLevel?: Record<string, number>;
    documentIds?: string[];
    fingerprintSha256?: string;
    error?: string;
  };
  fixtures?: {
    path: string;
    sha256?: string;
    configuredCases: number;
    eligibleCases: number;
    skippedCases: Array<{ id: string; reason: string }>;
  };
  metrics?: {
    recallAtK: number;
    mrr: number;
    completedCases: number;
    totalCases: number;
    contextPrecision?: number;
    faithfulness?: number;
    answerRelevancy?: number;
  };
  results: EvalResult[];
}

function fileSha256(filePath: string): string | undefined {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return undefined;
  }
}

function gitCommit(): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

export function resolveResultsPath(): string {
  return path.resolve(process.env.EVAL_RESULTS_PATH || DEFAULT_RESULTS_PATH);
}

export function writeEvaluationReport(report: EvaluationReport): void {
  fs.mkdirSync(path.dirname(report.reportPath), { recursive: true });
  const temporary = `${report.reportPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, report.reportPath);
}

async function collectCorpusMetadata(): Promise<EvaluationReport['corpus']> {
  try {
    const [documents, chunkCount, summaryChunkCount, chunkLevels] = await Promise.all([
      prisma.document.findMany({
        select: { id: true, docType: true, updatedAt: true },
        orderBy: { id: 'asc' },
      }),
      prisma.chunk.count(),
      prisma.chunk.count({ where: { isSummary: true } }),
      prisma.chunk.groupBy({ by: ['level'], _count: { _all: true }, orderBy: { level: 'asc' } }),
    ]);
    const documentsByType: Record<string, number> = {};
    for (const document of documents) {
      documentsByType[document.docType] = (documentsByType[document.docType] ?? 0) + 1;
    }
    return {
      available: documents.length > 0 && chunkCount > 0,
      documentCount: documents.length,
      chunkCount,
      summaryChunkCount,
      documentsByType,
      chunksByLevel: Object.fromEntries(chunkLevels.map((item) => [String(item.level), item._count._all])),
      documentIds: documents.map((document) => document.id),
      fingerprintSha256: crypto.createHash('sha256').update(JSON.stringify({
        documents: documents.map((document) => ({
          id: document.id,
          docType: document.docType,
          updatedAt: document.updatedAt.toISOString(),
        })),
        chunkCount,
        summaryChunkCount,
        chunkLevels: chunkLevels.map((item) => [item.level, item._count._all]),
      })).digest('hex'),
    };
  } catch (error) {
    return {
      available: false,
      error: sanitizeReason(error),
    };
  }
}

function sanitizeReason(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return reason.replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, '$1[redacted]@');
}

function externalRequirementFor(stage: string, corpus: EvaluationReport['corpus']): string {
  if (stage === 'corpus-preflight' && corpus.error) {
    return 'A reachable migrated PostgreSQL database configured by DATABASE_URL is required.';
  }
  if (stage === 'corpus-preflight') {
    return 'A non-empty corpus produced by a successful forced reindex is required.';
  }
  if (stage === 'generation/judging') {
    return 'EVAL_GENERATE=true requires a reachable configured LLM for answer generation and judging.';
  }
  if (stage === 'fixtures-preflight') {
    return 'At least one fixture source file must be indexed by the forced reindexer and present in backend/.reindex-manifest.json.';
  }
  return 'A ready embeddings service using the corpus embedding model/revision and a reachable migrated PostgreSQL corpus are required.';
}

function aggregateMetrics(results: EvalResult[], totalCases: number): EvaluationReport['metrics'] | undefined {
  if (results.length === 0) return undefined;
  const recallAtK = results.filter((result) => result.hit).length / results.length;
  const mrr = results.reduce((sum, result) => sum + (result.rank === null ? 0 : 1 / result.rank), 0) / results.length;
  const precision = results.filter((result) => result.contextPrecision !== undefined);
  const faithfulness = results.filter((result) => result.faithfulness !== undefined);
  const answerRelevancy = results.filter((result) => result.answerRelevancy !== undefined);
  return {
    recallAtK,
    mrr,
    completedCases: results.length,
    totalCases,
    ...(precision.length > 0 ? {
      contextPrecision: precision.reduce((sum, result) => sum + (result.contextPrecision ?? 0), 0) / precision.length,
    } : {}),
    ...(faithfulness.length > 0 ? {
      faithfulness: faithfulness.reduce((sum, result) => sum + (result.faithfulness ?? 0), 0) / faithfulness.length,
    } : {}),
    ...(answerRelevancy.length > 0 ? {
      answerRelevancy: answerRelevancy.reduce((sum, result) => sum + (result.answerRelevancy ?? 0), 0) / answerRelevancy.length,
    } : {}),
  };
}

function chunkMatchesCase(chunkContent: string, evalCase: EvalCase): boolean {
  const lower = chunkContent.toLowerCase();
  return evalCase.expectedKeywords.every((kw) => lower.includes(kw.toLowerCase()));
}

/**
 * Task D: generate a grounded answer strictly from retrieved context, for
 * faithfulness/answer-relevancy scoring. Reuses getLLMConfig + callLLM.
 */
async function generateAnswer(query: string, context: string): Promise<string> {
  const cfg = await getLLMConfig(undefined);
  return callLLM(
    cfg,
    [
      {
        role: 'system',
        content:
          'Bạn là trợ lý pháp lý. Chỉ trả lời dựa CHỈ trên ngữ cảnh được cung cấp. Nếu ngữ cảnh không đủ, nói rõ không đủ thông tin.',
      },
      {
        role: 'user',
        content: `Ngữ cảnh:\n${context.substring(0, 6000)}\n\nCâu hỏi: ${query}\n\nTrả lời ngắn gọn.`,
      },
    ],
    { temperature: 0.1, max_tokens: 400 },
  );
}

// ─── Runner ─────────────────────────────────────────────────────────────────

export async function runEvaluation(topK = 5): Promise<EvaluationReport> {
  const fixturesPath = path.resolve(process.env.EVAL_FIXTURES_PATH || DEFAULT_EVAL_FIXTURES_PATH);
  const configuredCases = loadEvaluationCases(fixturesPath);
  let eligibleCases: EvalCase[] = [];
  console.log('═══════════════════════════════════════════════════');
  console.log('  RAG Evaluation — Recall@K & MRR');
  console.log(`  topK = ${topK}  |  ${configuredCases.length} configured test cases`);
  console.log('═══════════════════════════════════════════════════\n');

  const startedAt = new Date().toISOString();
  const results: EvalResult[] = [];
  const generationFailures: string[] = [];
  let stage = 'initialization';
  const report: EvaluationReport = {
    schemaVersion: 1,
    status: 'running',
    startedAt,
    evaluatedAt: startedAt,
    reportPath: resolveResultsPath(),
    topK,
    featureFlags: {
      ENABLE_QUERY_REWRITER: process.env.ENABLE_QUERY_REWRITER === 'true',
      ENABLE_SUMMARY_CHUNKS: process.env.ENABLE_SUMMARY_CHUNKS === 'true',
      ENABLE_RERANK_FILTER: process.env.ENABLE_RERANK_FILTER === 'true',
      ENABLE_SELF_CORRECT: process.env.ENABLE_SELF_CORRECT === 'true',
      EVAL_GENERATE,
      embeddingModel: process.env.EMBEDDING_MODEL_ID ?? process.env.EMBEDDING_MODEL,
      embeddingRevision: process.env.EMBEDDING_MODEL_REVISION,
    },
    build: {
      scriptSha256: fileSha256(__filename) ?? 'unavailable',
      gitCommit: gitCommit(),
      nodeVersion: process.version,
      reindexManifestSha256: fileSha256(REINDEX_MANIFEST_PATH),
      latestReindexReportSha256: fileSha256(path.join(RAG_RESULTS_DIR, 'reindex-latest.json')),
    },
    corpus: { available: false },
    fixtures: {
      path: fixturesPath,
      sha256: fileSha256(fixturesPath),
      configuredCases: configuredCases.length,
      eligibleCases: 0,
      skippedCases: [],
    },
    results,
  };
  writeEvaluationReport(report);

  try {
    stage = 'corpus-preflight';
    report.corpus = await collectCorpusMetadata();
    writeEvaluationReport(report);
    if (!report.corpus.available) {
      const detail = report.corpus.error
        ? `Corpus database unavailable: ${report.corpus.error}`
        : `Corpus is empty (${report.corpus.documentCount ?? 0} documents, ${report.corpus.chunkCount ?? 0} chunks)`;
      throw new Error(detail);
    }

    stage = 'fixtures-preflight';
    const resolved = resolveEligibleCases(configuredCases, report.corpus.documentIds ?? []);
    eligibleCases = resolved.eligible;
    report.fixtures = {
      ...report.fixtures!,
      eligibleCases: eligibleCases.length,
      skippedCases: resolved.skipped,
    };
    writeEvaluationReport(report);
    if (eligibleCases.length === 0) {
      throw new Error('No evaluation fixtures have their required source files in the active corpus');
    }

    for (const evalCase of eligibleCases) {
      stage = `retrieval:${evalCase.id}`;
      const startedAt = Date.now();
      const docType = evaluationDocumentType(evalCase);
      const chunks = await retrieveWithQuality(
        evalCase.query,
        (query) => ragService.search(query, Math.min(50, Math.max(topK * 4, 12)), docType, SYSTEM_ACCESS),
        { candidateLimit: Math.min(50, Math.max(topK * 4, 12)), finalLimit: topK, docType },
      );
      let hitRank: number | null = null;
      const evidenceOnly = selectEvaluationEvidence(chunks, topK);
      const evidenceForMetrics = evidenceOnly.length > 0 ? evidenceOnly : chunks;
      const hasId = <T extends { id?: string; documentId?: string }>(
        chunk: T,
      ): chunk is T & { id: string; documentId: string } =>
        typeof chunk.id === 'string' && typeof chunk.documentId === 'string';
      const labeledEvidence = evidenceForMetrics.filter(hasId);

      for (let i = 0; i < labeledEvidence.length; i++) {
        const exactGoldMatch =
          evalCase.expectedChunkIds?.includes(labeledEvidence[i].id) ||
          evalCase.expectedDocumentIds?.includes(labeledEvidence[i].documentId);
        if (exactGoldMatch || (!evalCase.expectedChunkIds?.length && !evalCase.expectedDocumentIds?.length && chunkMatchesCase(labeledEvidence[i].content, evalCase))) {
          hitRank = i + 1;
          break;
        }
      }

      const result: EvalResult = {
        id: evalCase.id,
        query: evalCase.query,
        hit: evalCase.expectedNoAnswer ? evidenceForMetrics.length === 0 : hitRank !== null,
        rank: hitRank,
        retrievedCount: evidenceForMetrics.length,
        latencyMs: Date.now() - startedAt,
        retrievedChunkIds: labeledEvidence.map((chunk) => chunk.id),
        retrievedDocumentIds: [...new Set(labeledEvidence.map((chunk) => chunk.documentId))],
      };

      if (evalCase.expectedChunkIds?.length || evalCase.expectedDocumentIds?.length) {
        const relevant = labeledEvidence.filter((chunk) =>
          evalCase.expectedChunkIds?.includes(chunk.id) || evalCase.expectedDocumentIds?.includes(chunk.documentId),
        ).length;
        result.contextPrecision = evidenceForMetrics.length > 0 ? relevant / evidenceForMetrics.length : 0;
      }

      // Task D: optional generation + faithfulness/answerability (LLM calls).
      if (EVAL_GENERATE && evidenceForMetrics.length > 0) {
        try {
          const context = evidenceForMetrics.map((c) => c.content).join('\n\n');
          const answer = await generateAnswer(evalCase.query, context);
          result.faithfulness = await checkFaithfulness(evalCase.query, answer, context);
          result.answerRelevancy = await checkAnswerRelevancy(evalCase.query, answer);
        } catch (generationError) {
          result.error = `generation/judge: ${sanitizeReason(generationError)}`;
          generationFailures.push(evalCase.id);
          console.log(`  [${evalCase.id}] generation/judge ERROR: ${sanitizeReason(generationError)}`);
        }
      }

      results.push(result);
      report.metrics = aggregateMetrics(results, eligibleCases.length);
      report.evaluatedAt = new Date().toISOString();
      writeEvaluationReport(report);

      const status = result.hit ? `hit rank=${hitRank}` : 'miss';
      console.log(`  [${evalCase.id}] ${status}  (${evidenceForMetrics.length} chunks retrieved)`);
    }

    if (generationFailures.length > 0) {
      stage = 'generation/judging';
      throw new Error(`Generation/judging failed for: ${generationFailures.join(', ')}`);
    }

    report.status = 'success';
  } catch (error) {
    report.status = 'failed';
    report.failure = {
      stage,
      reason: sanitizeReason(error),
      externalRequirement: externalRequirementFor(stage, report.corpus),
    };
  } finally {
    report.metrics = aggregateMetrics(results, eligibleCases.length);
    report.evaluatedAt = new Date().toISOString();
    writeEvaluationReport(report);
  }

  const total = results.length;
  const hits = results.filter((result) => result.hit).length;
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  Status           : ${report.status}`);
  console.log(`  Completed cases  : ${total}/${eligibleCases.length}`);
  console.log(`  Skipped fixtures : ${report.fixtures?.skippedCases.length ?? 0}`);
  if (report.metrics) {
    console.log(`  Hits             : ${hits}`);
    console.log(`  Recall@${topK}       : ${(report.metrics.recallAtK * 100).toFixed(1)}%`);
    console.log(`  MRR              : ${report.metrics.mrr.toFixed(4)}`);
  }
  console.log(`  Report           : ${report.reportPath}`);
  console.log('═══════════════════════════════════════════════════\n');

  if (report.status === 'failed') {
    throw new Error(`${report.failure?.reason}; report: ${report.reportPath}`);
  }
  return report;
}

// ─── Entry ──────────────────────────────────────────────────────────────────
if (require.main === module) runEvaluation()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error('Evaluation failed:', sanitizeReason(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
