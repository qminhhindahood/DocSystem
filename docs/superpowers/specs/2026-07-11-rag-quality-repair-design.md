# RAG Quality Repair Design

## Status

Approved scope: repair the completed RAG A–H work and the directly related
Docker/Prisma startup path without resetting or deleting the existing database.

## Goal

Make the RAG quality loop safe to enable, correctly wired on its real request
paths, measurable by the evaluator, and reproducible in a fresh Docker setup.
Preserve the user's existing uncommitted work and keep every quality feature
opt-in by environment flag.

## Current Constraints

- The repository is intentionally dirty; no unrelated changes will be reverted.
- The current database has application tables but no recorded Prisma migrations.
  Migration adoption must therefore fail closed rather than assuming it is safe
  to run all historical migrations.
- Existing data must not be dropped, reset, or silently re-indexed.
- External LLM, embeddings, and database failures must not turn a successful
  base ingestion/retrieval request into a failure when an optional quality
  feature is enabled.

## Chosen Approach

Use one shared retrieval-quality path, make summary handling a best-effort
extension of both ingestion paths, and switch fresh Docker installations to
Prisma-managed schema creation. Existing legacy databases receive an explicit,
backup-first adoption/check procedure instead of automatic migration history
changes.

This is preferred over a narrow code-only repair because the new columns cannot
reliably exist in a fresh Compose deployment today. It is preferred over a
database reset because existing documents and feedback must be preserved.

## Architecture

### 1. Canonical retrieval quality path

A single helper will own the ordered sequence:

1. Rewrite the original query when query rewriting is enabled.
2. Search the existing hybrid RAG service.
3. Apply the relevancy filter exactly once.
4. When self-correction is enabled and fewer than two relevant chunks remain,
   rewrite and retry at most once.

QA, the orchestrator researcher, and evaluation will call this helper. This
eliminates QA's duplicate filtering and ensures the evaluator measures the same
behavior users receive. The researcher will receive and forward `userId`, so
personal LLM configuration remains intact.

### 2. Summary chunks and text cleaning

Summary creation will be exposed as a small RAG service operation and used once
per document from both synchronous indexing and asynchronous upload ingestion.
It will:

- run only when `ENABLE_SUMMARY_CHUNKS=true`;
- clean corpus text before chunking and summary generation;
- write only columns that really exist on `Chunk`;
- validate/embed the summary like ordinary chunks;
- log and skip a failed optional summary without failing the base document;
- avoid duplicate summary rows for a document on retries.

Search will neither query nor prepend summaries while the feature is disabled.
When enabled, it will preserve the caller's `topK` contract by placing the
document summary first and trimming the final result set to `topK`; it will
retain document metadata for QA citations.

The cleaner will restore CRLF normalization, remove only intended OCR control
characters, repair hyphenated line wraps without merging normal paragraphs, and
be covered by Vietnamese-text regression tests.

### 3. Generation correction and QA contract

`WriterAgent.write` will judge its first completed draft and make at most one
grounded regeneration when the quality gate requests it. Streaming generation
will not be retracted; its route will judge the completed text and send a
`lowConfidence` field before its terminal SSE event.

The backend QA payload will be aligned with the existing frontend's `sources`
contract, and the QA page will visibly surface a low-confidence warning. This
makes the new quality signal actionable instead of silently discarded.

### 4. Evaluation and promotion consistency

The evaluator will use the canonical retrieval helper, fail clearly when a
dependency is unavailable rather than reporting an all-miss "success," and
keep generation metrics opt-in. Faithfulness will remain context-vs-answer;
answer relevancy will be judged against the question and answer rather than
being mislabeled answerability.

Both synchronous and queued feedback promotion will share one docType resolver
and one fallback policy. The queued-job operation will be factored enough to be
tested without an infinite worker loop.

### 5. Docker and Prisma lifecycle

Fresh Compose deployments will use Prisma migrations rather than the stale
schema bootstrap SQL. The HNSW index will be created after the migrated `Chunk`
table exists. The backend startup command will run `prisma migrate deploy` only
for a migration-managed database.

For the current legacy database, a documented adoption check will inspect
schema drift and stop if it cannot prove compatibility. It will require a
backup before marking historical migrations as applied or applying the new
summary migration. No automatic migration-history rewrite or destructive action
will occur.

Development scripts will be made executable as documented (`tsx` evaluator and
current frontend lint command), and example environment variables will include
the actually supported RAG controls.

## Error Handling

- Base retrieval/ingestion remains available when optional LLM quality calls
  fail; retrieval falls back to the best available unfiltered chunks.
- Invalid judge output, impossible retry values, and out-of-range scores are
  handled conservatively and bounded to safe ranges.
- Evaluation exits non-zero on infrastructure failure so metrics cannot be
  mistaken for a successful baseline.
- Database bootstrap/adoption failures report the precise next safe action;
  they never reset a volume or alter data implicitly.

## Verification

- Add unit/contract tests for feature gates, Unicode cleaning, summary SQL,
  both ingestion paths, canonical retrieval behavior, retry bounds, writer
  regeneration, QA SSE payloads, evaluator routing, and promotion fallback.
- Run backend and frontend typechecks, full test suites, lint, Prisma validation,
  migration-status/adoption checks, and `git diff --check`.
- With Docker services healthy, apply the safe migration path, run a real
  summary-enabled ingestion, query it through QA, and capture baseline and
  enabled evaluation results in the RAG plan.

## Non-goals

- No database reset, corpus-wide automatic re-index, or retrospective mutation
  of existing feedback chunks.
- No changes to the core pgvector/RRF retrieval algorithm beyond correctly
  gating and integrating the approved quality-loop features.
