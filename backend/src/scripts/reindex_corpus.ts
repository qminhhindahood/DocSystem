/**
 * Deliberate, reportable corpus replacement.
 *
 * Usage:
 *   npx tsx src/scripts/reindex_corpus.ts --force --dir <pdf-dir> --doctype <id>
 *   npx tsx src/scripts/reindex_corpus.ts --force --file <pdf> [--file <pdf> ...] --doctype <id>
 *
 * A forced run stages every replacement before deleting manifest-tracked prior
 * documents. Any indexing failure removes staged documents and preserves the
 * old corpus.
 */

import crypto from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { DOCUMENT_TYPE_IDS } from '../middleware/validation';
import { ragService } from '../services/rag_service';
import { SYSTEM_ACCESS } from '../utils/document_access';
import { prisma } from '../utils/prisma';
import { PROJECT_ROOT, RAG_RESULTS_DIR, REINDEX_MANIFEST_PATH } from './script_paths';

const MANIFEST_PATH = REINDEX_MANIFEST_PATH;
const DEFAULT_REPORT_PATH = path.join(RAG_RESULTS_DIR, 'reindex-latest.json');
const VALID_DOC_TYPES = new Set<string>(DOCUMENT_TYPE_IDS);

interface ManifestEntry {
  docId: string;
  file: string;
  indexedAt: string;
}

interface Manifest {
  [sha256: string]: ManifestEntry;
}

interface DocumentSnapshot {
  documentId: string;
  exists: boolean;
  chunkCount: number;
  embeddedChunkCount: number;
  chunkIds: string[];
}

interface ReindexInput {
  file: string;
  absolutePath: string;
  sizeBytes: number;
  sha256: string;
  old?: DocumentSnapshot;
  replacement?: DocumentSnapshot;
}

interface RunFailure {
  file?: string;
  stage: string;
  reason: string;
}

export interface ReindexReport {
  schemaVersion: 1;
  status: 'running' | 'success' | 'failed';
  startedAt: string;
  finishedAt?: string;
  reportPath: string;
  invocation: { force: boolean; dir?: string; files: string[]; docType: string };
  build: {
    scriptSha256: string;
    gitCommit?: string;
    nodeVersion: string;
    manifestBeforeSha256?: string;
  };
  sourceSet: { sha256?: string; totalBytes: number };
  inputs: ReindexInput[];
  counts: {
    inputFiles: number;
    oldDocuments: number;
    oldChunks: number;
    newDocuments: number;
    newChunks: number;
    newEmbeddedChunks: number;
  };
  externalRequirements: string[];
  failures: RunFailure[];
  rollback: { attempted: boolean; removedDocumentIds: string[]; failure?: string };
}

export interface ReindexArgs {
  dir?: string;
  files: string[];
  doctype: string;
  force: boolean;
  reportPath: string;
}

class UsageError extends Error {}

function sha256(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function fileSha256(filePath: string): string | undefined {
  try {
    return sha256(fs.readFileSync(filePath));
  } catch {
    return undefined;
  }
}

function sanitizeReason(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return reason.replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, '$1[redacted]@');
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

function loadManifest(): Manifest {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
  } catch {
    return {};
  }
}

function writeJsonAtomic(outputPath: string, value: unknown): void {
  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, resolved);
}

function requiredValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new UsageError(`${option} requires a value`);
  return value;
}

export function parseArgs(argv: string[]): ReindexArgs {
  if (argv.length === 0) {
    throw new UsageError('No action taken: --force, --doctype, and either --dir or --file are required');
  }
  let dir = '';
  const files: string[] = [];
  let doctype = '';
  let force = false;
  let reportPath = DEFAULT_REPORT_PATH;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--force') force = true;
    else if (argument === '--dir') dir = requiredValue(argv, index++, argument);
    else if (argument === '--file') files.push(requiredValue(argv, index++, argument));
    else if (argument === '--doctype') doctype = requiredValue(argv, index++, argument);
    else if (argument === '--report') reportPath = path.resolve(requiredValue(argv, index++, argument));
    else throw new UsageError(`Unknown option: ${argument}`);
  }
  if (!force) throw new UsageError('No action taken: --force is required for corpus replacement');
  if (!doctype) throw new UsageError('--doctype is required');
  if (Boolean(dir) === Boolean(files.length)) {
    throw new UsageError('Provide exactly one source mode: --dir or one or more --file options');
  }
  return {
    dir: dir ? path.resolve(dir) : undefined,
    files: files.map(file => path.resolve(file)),
    doctype,
    force,
    reportPath,
  };
}

export function assertUniqueSourceInputs(
  inputs: ReadonlyArray<{ file: string; sha256: string }>,
): void {
  const hashes = new Map<string, string>();
  const names = new Map<string, string>();
  for (const input of inputs) {
    const duplicateHash = hashes.get(input.sha256);
    if (duplicateHash) {
      throw new Error(`Duplicate PDF content in source batch: ${duplicateHash} and ${input.file}`);
    }
    const normalizedName = input.file.toLocaleLowerCase('en-US');
    const duplicateName = names.get(normalizedName);
    if (duplicateName) {
      throw new Error(`Duplicate PDF filename in source batch: ${duplicateName} and ${input.file}`);
    }
    hashes.set(input.sha256, input.file);
    names.set(normalizedName, input.file);
  }
}

async function snapshotDocument(documentId: string): Promise<DocumentSnapshot> {
  const [document, embeddingCounts] = await Promise.all([
    prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, chunks: { select: { id: true }, orderBy: { id: 'asc' } } },
    }),
    prisma.$queryRaw<Array<{ chunk_count: bigint; embedded_count: bigint }>>`
      SELECT COUNT(*)::bigint AS chunk_count,
             COUNT(embedding)::bigint AS embedded_count
      FROM "Chunk"
      WHERE "documentId" = ${documentId}
    `,
  ]);
  return {
    documentId,
    exists: document !== null,
    chunkCount: document?.chunks.length ?? 0,
    embeddedChunkCount: Number(embeddingCounts[0]?.embedded_count ?? 0),
    chunkIds: document?.chunks.map((chunk) => chunk.id) ?? [],
  };
}

function updateCounts(report: ReindexReport): void {
  const oldDocuments = report.inputs.filter((input) => input.old?.exists).length;
  const newDocuments = report.inputs.filter((input) => input.replacement?.exists).length;
  report.counts = {
    inputFiles: report.inputs.length,
    oldDocuments,
    oldChunks: report.inputs.reduce((sum, input) => sum + (input.old?.chunkCount ?? 0), 0),
    newDocuments,
    newChunks: report.inputs.reduce((sum, input) => sum + (input.replacement?.chunkCount ?? 0), 0),
    newEmbeddedChunks: report.inputs.reduce((sum, input) => sum + (input.replacement?.embeddedChunkCount ?? 0), 0),
  };
}

async function removeStagedDocuments(report: ReindexReport, documentIds: string[]): Promise<void> {
  report.rollback.attempted = true;
  if (documentIds.length === 0) return;
  try {
    await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
    report.rollback.removedDocumentIds = [...documentIds];
  } catch (error) {
    report.rollback.failure = error instanceof Error ? error.message : String(error);
  }
}

export async function runReindex(args: ReindexArgs): Promise<ReindexReport> {
  const startedAt = new Date();
  const report: ReindexReport = {
    schemaVersion: 1,
    status: 'running',
    startedAt: startedAt.toISOString(),
    reportPath: path.resolve(args.reportPath),
    invocation: { force: args.force, dir: args.dir, files: args.files, docType: args.doctype },
    build: {
      scriptSha256: fileSha256(__filename) ?? 'unavailable',
      gitCommit: gitCommit(),
      nodeVersion: process.version,
      manifestBeforeSha256: fileSha256(MANIFEST_PATH),
    },
    inputs: [],
    sourceSet: { totalBytes: 0 },
    counts: {
      inputFiles: 0,
      oldDocuments: 0,
      oldChunks: 0,
      newDocuments: 0,
      newChunks: 0,
      newEmbeddedChunks: 0,
    },
    externalRequirements: [
      'A reachable migrated PostgreSQL database configured by DATABASE_URL.',
      'A Docling service whose /ready endpoint returns 200 and proves PDF conversion.',
      'An embeddings service whose /ready endpoint returns 200 and returns 1024-dimensional vectors.',
    ],
    failures: [],
    rollback: { attempted: false, removedDocumentIds: [] },
  };
  writeJsonAtomic(report.reportPath, report);

  const stagedDocumentIds: string[] = [];
  let activeCreatedDocumentId: string | undefined;
  prisma.$use(async (params, next) => {
    const result = await next(params);
    if (params.model === 'Document' && params.action === 'create' && result && typeof result.id === 'string') {
      activeCreatedDocumentId = result.id;
    }
    return result;
  });
  let swapCommitted = false;
  let stage = 'preflight';
  try {
    if (!args.force) throw new Error('--force is required');
    if (!VALID_DOC_TYPES.has(args.doctype)) {
      throw new Error(`Invalid --doctype "${args.doctype}". Valid: ${[...VALID_DOC_TYPES].join(', ')}`);
    }
    let sourceFiles: Array<{ file: string; absolutePath: string }>;
    if (args.dir) {
      if (!fs.existsSync(args.dir) || !fs.statSync(args.dir).isDirectory()) {
        throw new Error(`PDF directory not found: ${args.dir}`);
      }
      sourceFiles = fs.readdirSync(args.dir)
        .filter(file => file.toLowerCase().endsWith('.pdf'))
        .sort()
        .map(file => ({ file, absolutePath: path.join(args.dir!, file) }));
      if (sourceFiles.length === 0) throw new Error(`No PDF files found in ${args.dir}`);
    } else {
      sourceFiles = args.files.map(absolutePath => ({ file: path.basename(absolutePath), absolutePath }));
      for (const source of sourceFiles) {
        if (!source.absolutePath.toLowerCase().endsWith('.pdf')
          || !fs.existsSync(source.absolutePath)
          || !fs.statSync(source.absolutePath).isFile()) {
          throw new Error(`PDF file not found: ${source.absolutePath}`);
        }
      }
    }
    const manifestBefore = loadManifest();

    for (const source of sourceFiles) {
      const bytes = fs.readFileSync(source.absolutePath);
      const sourceHash = sha256(bytes);
      const input: ReindexInput = {
        file: source.file,
        absolutePath: source.absolutePath,
        sizeBytes: bytes.length,
        sha256: sourceHash,
      };
      report.inputs.push(input);
    }
    assertUniqueSourceInputs(report.inputs);
    report.sourceSet = {
      sha256: sha256(report.inputs.map((input) => `${input.file}\0${input.sha256}\n`).join('')),
      totalBytes: report.inputs.reduce((sum, input) => sum + input.sizeBytes, 0),
    };
    updateCounts(report);
    writeJsonAtomic(report.reportPath, report);

    stage = 'corpus-snapshot';
    for (const input of report.inputs) {
      const oldManifest = manifestBefore[input.sha256]
        ?? Object.values(manifestBefore).find((entry) => entry.file === input.file);
      if (oldManifest) {
        input.old = {
          documentId: oldManifest.docId,
          exists: false,
          chunkCount: 0,
          embeddedChunkCount: 0,
          chunkIds: [],
        };
        input.old = await snapshotDocument(oldManifest.docId);
      }
    }
    updateCounts(report);
    writeJsonAtomic(report.reportPath, report);

    stage = 'index';
    for (const input of report.inputs) {
      activeCreatedDocumentId = undefined;
      try {
        const bytes = fs.readFileSync(input.absolutePath);
        const documentId = await ragService.indexDocument(bytes, args.doctype, SYSTEM_ACCESS, {
          title: path.parse(input.file).name.replace(/[_-]+/g, ' '),
          originalFilename: input.file,
          mimeType: 'application/pdf',
          fileSize: input.sizeBytes,
        });
        stagedDocumentIds.push(documentId);
        input.replacement = await snapshotDocument(documentId);
        if (input.replacement.chunkCount === 0) {
          throw new Error('Indexing produced no chunks');
        }
        if (input.replacement.embeddedChunkCount !== input.replacement.chunkCount) {
          throw new Error(
            `Indexing produced ${input.replacement.embeddedChunkCount}/${input.replacement.chunkCount} embedded chunks`,
          );
        }
        updateCounts(report);
        writeJsonAtomic(report.reportPath, report);
        console.log(`[reindex] staged ${input.file} -> ${documentId} (${input.replacement.chunkCount} chunks)`);
      } catch (error) {
        // Prisma middleware captures the exact row created by this in-process
        // indexing call. Never infer partial rows by title or delete concurrent data.
        if (activeCreatedDocumentId && !stagedDocumentIds.includes(activeCreatedDocumentId)) {
          stagedDocumentIds.push(activeCreatedDocumentId);
        }
        report.failures.push({
          file: input.file,
          stage: 'index',
          reason: sanitizeReason(error),
        });
        throw error;
      } finally {
        activeCreatedDocumentId = undefined;
      }
    }

    const oldDocumentIds = [...new Set(report.inputs
      .map((input) => input.old?.documentId)
      .filter((documentId): documentId is string => Boolean(documentId)))]
      .filter((documentId) => !stagedDocumentIds.includes(documentId));

    const manifestAfter: Manifest = { ...manifestBefore };
    for (const input of report.inputs) {
      for (const [hash, entry] of Object.entries(manifestAfter)) {
        if (hash === input.sha256 || entry.file === input.file) delete manifestAfter[hash];
      }
      manifestAfter[input.sha256] = {
        docId: input.replacement!.documentId,
        file: input.file,
        indexedAt: new Date().toISOString(),
      };
    }

    // Replace the manifest first. If the database swap fails, restore it before
    // rolling back staged records, so the old corpus and its manifest stay paired.
    stage = 'swap';
    writeJsonAtomic(report.reportPath, report);
    writeJsonAtomic(MANIFEST_PATH, manifestAfter);
    try {
      await prisma.$transaction(async (transaction) => {
        if (oldDocumentIds.length > 0) {
          await transaction.document.deleteMany({ where: { id: { in: oldDocumentIds } } });
        }
      });
      swapCommitted = true;
    } catch (error) {
      writeJsonAtomic(MANIFEST_PATH, manifestBefore);
      throw error;
    }

    report.status = 'success';
    report.finishedAt = new Date().toISOString();
    updateCounts(report);
  } catch (error) {
    if (report.failures.length === 0) {
      report.failures.push({
        stage,
        reason: sanitizeReason(error),
      });
    }
    if (!swapCommitted) await removeStagedDocuments(report, stagedDocumentIds);
    report.status = 'failed';
    report.finishedAt = new Date().toISOString();
    updateCounts(report);
  }

  writeJsonAtomic(report.reportPath, report);
  return report;
}

function usage(): string {
  return 'Usage: npx tsx src/scripts/reindex_corpus.ts --force (--dir <pdf-dir> | --file <pdf> [--file <pdf> ...]) --doctype <id> [--report <json>]';
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const args = parseArgs(argv);
    const report = await runReindex(args);
    console.log(`[reindex] ${report.status}; report: ${report.reportPath}`);
    return report.status === 'success' ? 0 : 1;
  } catch (error) {
    console.error(`[reindex] ${error instanceof Error ? error.message : String(error)}`);
    console.error(usage());
    return error instanceof UsageError ? 2 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
