# RAG Quality Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the RAG quality loop safe to enable, correctly integrated in production request paths, measurable by evaluation, and reproducible in Docker without resetting existing data.

**Architecture:** A shared `retrieveWithQuality()` helper will own rewriting, filtering, and one bounded retrieval retry. Summary generation becomes a gated, best-effort RAG service operation called by both indexing paths. Docker will create only the pgvector extension before Prisma applies a corrected migration chain; legacy databases will be diagnosed and adopted explicitly rather than mutated automatically.

**Tech Stack:** TypeScript 5, Express, Jest/ts-jest, Prisma 5/PostgreSQL/pgvector, Docker Compose, Next.js 16, ESLint.

## Global Constraints

- Preserve all existing user changes; do not reset, checkout, or delete files.
- Do not drop/reset the existing database or mutate migration history automatically.
- Keep `ENABLE_QUERY_REWRITER`, `ENABLE_SUMMARY_CHUNKS`, `ENABLE_RERANK_FILTER`, `ENABLE_SELF_CORRECT`, and `EVAL_GENERATE` opt-in.
- A quality-feature failure must preserve the base ingestion/retrieval result.
- Limit self-correction to one retry, even if an environment variable contains a larger value.
- Do not log secrets or write secrets into tracked files.

---

### Task 1: Establish a single, bounded retrieval-quality interface

**Files:**
- Modify: `backend/src/services/self_correct.ts`
- Modify: `backend/src/services/self_correct.test.ts`
- Modify: `backend/src/services/context_filter.ts`
- Modify: `backend/src/services/context_filter.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface RetrieveQualityOptions {
    userId?: string;
    docType?: string;
  }

  export async function retrieveWithQuality<T extends RelChunk>(
    query: string,
    search: (query: string) => Promise<T[]>,
    opts?: RetrieveQualityOptions,
  ): Promise<T[]>;
  ```
- `retryRetrieve()` accepts an already-rewritten query, filters once per search attempt, and returns the filtered non-empty result or the raw result.
- `checkFaithfulness`, `checkAnswerability`, and the new `checkAnswerRelevancy` return finite numbers clamped to `[0, 1]`.

- [ ] **Step 1: Write failing retrieval-flow and bounds tests**

  Add tests that prove the helper calls `rewriteQuery` once for the first search, filters once when self-correction is disabled, retries exactly once when enabled and fewer than two chunks remain, and never performs a third search when `RAG_MAX_RETRIES=99`.

  ```ts
  it('rewrites, searches, and filters exactly once without self-correction', async () => {
    process.env.ENABLE_QUERY_REWRITER = 'true';
    process.env.ENABLE_SELF_CORRECT = 'false';
    rw.rewriteQuery.mockResolvedValue('rewritten');
    search.mockResolvedValue(chunks);
    cf.filterRelevantChunks.mockResolvedValue([chunks[0]]);

    await expect(retrieveWithQuality('original', search)).resolves.toEqual([chunks[0]]);
    expect(rw.rewriteQuery).toHaveBeenCalledWith('original', undefined);
    expect(search).toHaveBeenCalledTimes(1);
    expect(cf.filterRelevantChunks).toHaveBeenCalledTimes(1);
  });
  ```

- [ ] **Step 2: Run the focused tests and confirm failure**

  Run: `npx jest --runInBand src/services/self_correct.test.ts src/services/context_filter.test.ts`

  Expected: FAIL because `retrieveWithQuality` and `checkAnswerRelevancy` do not exist and retry bounds are not clamped.

- [ ] **Step 3: Implement the minimal canonical helper and safe score parsing**

  In `self_correct.ts`, use a clamp that preserves zero and caps retry count:

  ```ts
  const boundedNumber = (raw: string | undefined, fallback: number) => {
    const value = Number(raw);
    return Number.isFinite(value) ? Math.max(0, Math.min(Math.trunc(value), 1)) : fallback;
  };
  const maxRetries = () => boundedNumber(process.env.RAG_MAX_RETRIES, 1);

  export async function retrieveWithQuality<T extends RelChunk>(
    query: string,
    search: (q: string) => Promise<T[]>,
    opts: RetrieveQualityOptions = {},
  ): Promise<T[]> {
    const rewritten = await rewriteQuery(query, opts.userId);
    if (ENABLE_SELF_CORRECT()) {
      return retryRetrieve(rewritten, search, opts) as Promise<T[]>;
    }
    const raw = await search(rewritten);
    return filterRelevantChunks(query, raw, opts.userId) as Promise<T[]>;
  }
  ```

  In `context_filter.ts`, add `parseScore(raw)` that uses `Number`, rejects non-finite values, and clamps to 0–1. Implement `checkAnswerRelevancy(question, answer, userId?)` with a question/answer-only judge prompt. Remove the unused `RAG_RELEVANCY_THRESHOLD` export rather than documenting a no-op setting.

- [ ] **Step 4: Run focused tests and typecheck**

  Run: `npx jest --runInBand src/services/self_correct.test.ts src/services/context_filter.test.ts`

  Expected: PASS, including zero retry, one-retry maximum, malformed score, and answer-relevancy cases.

  Run: `npx tsc --noEmit --incremental false`

  Expected: exit 0.

- [ ] **Step 5: Record the task commit boundary**

  Do not commit while the user-owned worktree is dirty. Record the exact changed paths in `git diff --name-only` for the final atomic commit after the user reviews the full repair.

### Task 2: Repair summary lifecycle, gates, metadata, and text cleaning

**Files:**
- Modify: `backend/src/services/rag_service.ts`
- Modify: `backend/src/services/rag_service.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SummaryChunkMetadata {
    isSummary: true;
    summaryOf: string;
  }

  async indexDocumentSummary(
    documentId: string,
    text: string,
    docType: string,
    userId?: string,
  ): Promise<void>;
  ```
- `search(query, topK, docType)` returns no more than `topK` chunks and does not reference `isSummary` when summaries are disabled.

- [ ] **Step 1: Write failing RAG service tests**

  Add tests for all of these contracts:

  ```ts
  it('does not query summary columns when summaries are disabled', async () => {
    process.env.ENABLE_SUMMARY_CHUNKS = 'false';
    await ragService.search('thể thức', 2);
    expect(prisma.$queryRaw.mock.calls.flat().join('')).not.toContain('isSummary');
  });

  it('uses CRLF normalization without rewriting punctuation', () => {
    const chunks = ragService.chunkDocument('Điều 1. A\r\n“B” – C');
    expect(chunks.map((chunk) => chunk.content).join('\n')).toContain('“B” – C');
  });

  it('repairs a hyphenated Vietnamese line wrap without merging paragraphs', () => {
    const clean = (ragService as any).cleanCorpusText('tư-\nời\n\nđoạn mới');
    expect(clean).toContain('tười');
    expect(clean).toContain('\n\nđoạn mới');
  });
  ```

  Add a summary-insert assertion that the generated SQL contains `"createdAt"` but not `"updatedAt"`, and an enabled-search assertion that summary metadata contains the document title/docType and total results remain `topK`.

- [ ] **Step 2: Run the RAG service tests and confirm failure**

  Run: `npx jest --runInBand src/services/rag_service.test.ts`

  Expected: FAIL on gate behavior, corrupted normalization, invalid SQL column, or result-size contract.

- [ ] **Step 3: Implement correct cleaning and summary operations**

  Restore normalized line endings and use narrow OCR repairs:

  ```ts
  private cleanCorpusText(text: string): string {
    return text
      .replace(/\r\n?/g, '\n')
      .replace(/\u00AD|\u0008/g, '')
      .replace(/([\p{L}])-[ \t]*\n[ \t]*([\p{Ll}])/gu, '$1$2')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  ```

  Gate every summary-specific query with `ENABLE_SUMMARY_CHUNKS()`. Make `indexDocumentSummary` clean the supplied source, generate at most one summary, check whether a summary already exists for the document, embed it, and insert only schema columns:

  ```sql
  INSERT INTO "Chunk" ("id", "documentId", "content", "level", "isSummary", "summaryOf", "embedding", "createdAt")
  VALUES (...)
  ```

  Wrap the optional summary operation at both callers with `try/catch` and warn without rethrowing. Join `Document` in the prepend query, use deterministic `ORDER BY "createdAt" ASC`, and return `[summary, ...chunks].slice(0, safeTopK)`.

- [ ] **Step 4: Run focused tests and typecheck**

  Run: `npx jest --runInBand src/services/rag_service.test.ts`

  Expected: PASS with no summary query while disabled and correct enabled behavior.

  Run: `npx tsc --noEmit --incremental false`

  Expected: exit 0.

- [ ] **Step 5: Record the task commit boundary**

  Record `backend/src/services/rag_service.ts` and `backend/src/services/rag_service.test.ts` for the final atomic commit; do not stage user changes mid-repair.

### Task 3: Add summaries to the asynchronous upload pipeline

**Files:**
- Modify: `backend/src/services/ingestion_service.ts`
- Create: `backend/src/services/ingestion_service.test.ts`

**Interfaces:**
- Consumes: `ragService.indexDocumentSummary(documentId, cleanedText, docType)` from Task 2.
- Produces: `processIngestion()` indexes ordinary chunks and then makes one best-effort summary call when enabled.

- [ ] **Step 1: Write a failing ingestion test**

  Mock `prisma.document`, `ragService.chunkDocument`, `ragService.indexChunk`, and `ragService.indexDocumentSummary`. Verify that summary creation receives the parsed text and docType once after chunks, while a rejected summary promise still produces `ingestionStatus: 'indexed'`.

  ```ts
  expect(ragService.indexDocumentSummary).toHaveBeenCalledWith(
    'doc-1', 'parsed document', 'cong-van', undefined,
  );
  expect(prisma.document.update).toHaveBeenLastCalledWith(expect.objectContaining({
    data: expect.objectContaining({ ingestionStatus: 'indexed' }),
  }));
  ```

- [ ] **Step 2: Run the new test and confirm failure**

  Run: `npx jest --runInBand src/services/ingestion_service.test.ts`

  Expected: FAIL because `processIngestion` never invokes summary indexing.

- [ ] **Step 3: Add the best-effort summary call**

  After normal chunks are indexed and before `updateStatus(..., 'indexed')`, call:

  ```ts
  try {
    await ragService.indexDocumentSummary(documentId, cleanedText, doc?.docType || 'unknown');
  } catch (err) {
    console.warn(`[Ingestion] Summary generation failed for ${documentId}; continuing:`, err);
  }
  ```

  Keep ordinary chunk indexing and cleanup behavior unchanged.

- [ ] **Step 4: Run the test and full backend typecheck**

  Run: `npx jest --runInBand src/services/ingestion_service.test.ts`

  Expected: PASS for enabled, disabled, and failing-summary cases.

  Run: `npx tsc --noEmit --incremental false`

  Expected: exit 0.

### Task 4: Wire canonical retrieval and user LLM configuration

**Files:**
- Modify: `backend/src/services/orchestrator.ts`
- Modify: `backend/src/routes/workflow.ts`
- Modify: `backend/src/routes/qa.ts`
- Modify: `backend/src/routes/workflow.contract.test.ts`
- Modify: `backend/src/routes/qa.contract.test.ts`

**Interfaces:**
- `ResearcherAgent.research(outline: string, docType?: string, userId?: string)`.
- QA calls `retrieveWithQuality(question, q => ragService.search(q, topK, docType), { userId, docType })` once.

- [ ] **Step 1: Write failing route/agent contract tests**

  Update workflow expectations to include the third `userId` argument. Add a QA route test that mocks `retrieveWithQuality` and asserts it receives the original question and authenticated user ID, then emits `sources` rather than only `citations`.

  ```ts
  expect(researcher.research).toHaveBeenCalledWith('outline', 'cong-van', undefined);
  expect(retrieveWithQuality).toHaveBeenCalledWith(
    'Điều 1 quy định gì?', expect.any(Function), { userId: undefined, docType: undefined },
  );
  ```

- [ ] **Step 2: Run the affected contract tests and confirm failure**

  Run: `npx jest --runInBand src/routes/workflow.contract.test.ts src/routes/qa.contract.test.ts`

  Expected: FAIL because researcher ignores `userId`, QA duplicates filtering, and payload uses `citations`.

- [ ] **Step 3: Replace duplicated path wiring**

  Make `ResearcherAgent.research` accept/pass `userId` and use `retrieveWithQuality`. Update both workflow call sites to pass their in-scope `userId`. In QA, replace `rewriteQuery` + `retryRetrieve` + second `filterRelevantChunks` with the one helper. Build a single `sources` array from returned chunks and use it in all SSE events, preserving `citations` only as a temporary alias if another client needs backward compatibility.

- [ ] **Step 4: Run contract tests and typecheck**

  Run: `npx jest --runInBand src/routes/workflow.contract.test.ts src/routes/qa.contract.test.ts`

  Expected: PASS with exactly one quality retrieval path and the forwarded ID.

  Run: `npx tsc --noEmit --incremental false`

  Expected: exit 0.

### Task 5: Complete bounded generation correction and visible QA confidence

**Files:**
- Modify: `backend/src/services/orchestrator.ts`
- Create: `backend/src/services/orchestrator.test.ts`
- Modify: `backend/src/routes/qa.ts`
- Modify: `frontend/app/qa/page.tsx`
- Modify: `frontend/lib/api.ts`

**Interfaces:**
- `WriterAgent.write()` may call `callLLM` twice at most when `shouldRegenerate()` is true.
- QA terminal event has `lowConfidence: boolean` and `sources: QASource[]`.

- [ ] **Step 1: Write failing writer and QA event tests**

  Mock `callLLM` and `shouldRegenerate` to verify one retry and a grounded retry instruction:

  ```ts
  shouldRegenerateMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await expect(writer.write('outline', [], 'request')).resolves.toBe('retry draft');
  expect(callLLM).toHaveBeenCalledTimes(2);
  expect(callLLM.mock.calls[1][1][1].content).toContain('Chỉ sử dụng ngữ cảnh');
  ```

  In the QA contract, assert `lowConfidence` is calculated before the `stage: 'complete'` record is serialized.

- [ ] **Step 2: Run focused tests and confirm failure**

  Run: `npx jest --runInBand src/services/orchestrator.test.ts src/routes/qa.contract.test.ts`

  Expected: FAIL because writer returns on its first call and QA sends confidence after completion.

- [ ] **Step 3: Implement one non-streaming regeneration and terminal confidence field**

  Refactor the writer request construction into a local `generate(extraInstruction = '')` closure. Generate once, then run `shouldRegenerate(userPrompt, draft, contextText, userId)` and generate exactly one more time with:

  ```ts
  '\n\nChỉ sử dụng ngữ cảnh đã cung cấp. Nếu ngữ cảnh thiếu, nêu rõ giới hạn thay vì suy đoán.'
  ```

  In QA, calculate `lowConfidence` after streaming finishes but before sending the terminal event. Emit it as a boolean in that event. In the frontend, add `lowConfidence?: boolean` to the event/message shape and display the existing toast warning when a completed answer carries `true`.

- [ ] **Step 4: Run tests, frontend typecheck, and lint**

  Run: `npx jest --runInBand src/services/orchestrator.test.ts src/routes/qa.contract.test.ts`

  Expected: PASS.

  Run: `npx tsc --noEmit --incremental false`

  Expected: exit 0 from `frontend`.

  Run: `npm run lint`

  Expected: exit 0 after Task 8 updates the script.

### Task 6: Make evaluation measure runtime behavior and fail honestly

**Files:**
- Modify: `backend/src/scripts/evaluate_rag.ts`
- Create: `backend/src/scripts/evaluate_rag.test.ts`

**Interfaces:**
- Export `runEvaluation(topK?: number): Promise<EvaluationSummary>`.
- The executable entry point is guarded by `if (require.main === module)`.
- Evaluation calls `retrieveWithQuality` for every case and throws a descriptive error if search infrastructure fails.

- [ ] **Step 1: Write failing evaluator routing tests**

  Mock `retrieveWithQuality` and assert it is called for every evaluation case. Mock a retrieval error and assert `runEvaluation()` rejects rather than returning a successful all-miss summary. With `EVAL_GENERATE=true`, assert it calls `checkFaithfulness` and `checkAnswerRelevancy`, not `checkAnswerability`.

- [ ] **Step 2: Run the evaluator tests and confirm failure**

  Run: `npx jest --runInBand src/scripts/evaluate_rag.test.ts`

  Expected: FAIL because the script invokes `ragService.search` directly and catches infrastructure errors as misses.

- [ ] **Step 3: Export and correct evaluation behavior**

  Replace the raw search call with:

  ```ts
  const chunks = await retrieveWithQuality(
    evalCase.query,
    (query) => ragService.search(query, topK),
  );
  ```

  Build answer-relevancy from the generated answer, retain answerability only for self-correction, and throw a labelled `RAG evaluation failed for <case id>` error on retrieval failure. Keep `EVAL_GENERATE` opt-in.

- [ ] **Step 4: Run evaluator tests and a disabled-gate smoke command**

  Run: `npx jest --runInBand src/scripts/evaluate_rag.test.ts`

  Expected: PASS.

  Run: `npx tsx src/scripts/evaluate_rag.ts`

  Expected: either real metrics with healthy services or a non-zero, explicit dependency failure; never an all-miss success report.

### Task 7: Align feedback promotion behavior and prove the queued path

**Files:**
- Modify: `backend/src/services/feedback_rag_promotion.ts`
- Modify: `backend/src/services/feedback_rag_promotion.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function processRagPromotionJob(job: {
    feedbackId: string;
    editedContent: string;
    documentId?: string;
  }): Promise<number>;
  ```
- Both sync and queued promotions call `resolvePromotionDocType(documentId)` and use the same fallback string, `'approved_feedback'`.

- [ ] **Step 1: Add failing sync/queued consistency tests**

  Mock the resolver and the document/chunk creator. Assert that the synchronous path and `processRagPromotionJob` pass the same docType for a found source document and for an absent ID.

- [ ] **Step 2: Run the focused promotion test and confirm failure**

  Run: `npx jest --runInBand src/services/feedback_rag_promotion.test.ts`

  Expected: FAIL because the sync path uses `'unknown'` and the worker loop cannot be tested as one job.

- [ ] **Step 3: Extract the one-job operation and reuse resolver**

  Have the worker parse a Redis job and call `processRagPromotionJob`. Replace the sync fallback expression with `await resolvePromotionDocType(feedback.documentId)`. Keep worker logging/error handling unchanged.

- [ ] **Step 4: Run the focused test and typecheck**

  Run: `npx jest --runInBand src/services/feedback_rag_promotion.test.ts`

  Expected: PASS for both docType branches.

  Run: `npx tsc --noEmit --incremental false`

  Expected: exit 0.

### Task 8: Repair executable developer scripts and documented RAG controls

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `backend/.env.example`
- Modify: `README.md`

**Interfaces:**
- Backend declares `tsx` in `devDependencies` so `npx tsx src/scripts/evaluate_rag.ts` is reproducible.
- Frontend `lint` script is `eslint . --max-warnings=0` and does not call removed `next lint`.

- [ ] **Step 1: Add script/config assertions**

  Use package-manager commands as the test surface:

  ```powershell
  npm run lint
  npm test -- --runInBand --ci --passWithNoTests
  npx tsx --version
  ```

  Record the current expected failures: obsolete `next lint`, no `tsx` declaration, and Jest exit 1 with no frontend tests.

- [ ] **Step 2: Add only required tooling configuration**

  Install `tsx` as a backend development dependency. Set frontend scripts to:

  ```json
  {
    "lint": "eslint . --max-warnings=0",
    "test": "jest --passWithNoTests"
  }
  ```

  Add the supported RAG settings to `backend/.env.example`:

  ```env
  RAG_RRF_K="60"
  RAG_OVERFETCH_MULTIPLIER="4"
  ```

  Update README commands to use `npm run lint`, the declared evaluator command, and the gate/measurement sequence.

- [ ] **Step 3: Run the developer-tool verification commands**

  Run from `backend`: `npx tsx --version`

  Expected: prints a version.

  Run from `frontend`: `npm run lint` and `npm test -- --runInBand --ci`

  Expected: exit 0.

### Task 9: Make fresh Docker startup Prisma-managed and diagnose legacy databases safely

**Files:**
- Modify: `backend/prisma/migrations/20250608000000_rename_ollama_to_lmstudio/migration.sql`
- Create: `backend/prisma/migrations/20260711000000_rename_ollama_to_lmstudio_after_init/migration.sql`
- Modify: `init.sql`
- Modify: `docker-compose.yml`
- Modify: `backend/Dockerfile`
- Modify: `backend/src/index.ts`
- Create: `backend/scripts/check_prisma_adoption.ts`
- Create: `backend/src/index.health.test.ts`
- Modify: `README.md`

**Interfaces:**
- A fresh empty Postgres database can run `npx prisma migrate deploy` without a missing-table error.
- `check_prisma_adoption.ts` is read-only and exits non-zero when `_prisma_migrations` is absent or expected columns are missing.

- [ ] **Step 1: Write the migration/adoption preflight tests**

  Add a script-level test or deterministic command assertions that verify the migration sequence contains no unconditional `ALTER TABLE "ModelVersion"` before the initial migration and that the adoption script reports all required columns:

  ```ts
  const required = [
    ['Chunk', 'isSummary'], ['Chunk', 'summaryOf'],
    ['Document', 'ingestionStatus'], ['Document', 'storageKey'],
  ];
  ```

- [ ] **Step 2: Run the preflight and confirm existing legacy state is rejected safely**

  Run: `npx tsx scripts/check_prisma_adoption.ts`

  Expected: exit 1 with a message that the current database has no migration history and must be backed up/adopted explicitly.

- [ ] **Step 3: Repair fresh migration ordering without assuming legacy history**

  Make the old pre-initial migration conditional:

  ```sql
  DO $$
  BEGIN
    IF to_regclass('public."ModelVersion"') IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'ModelVersion'
           AND column_name = 'ollamaModelName'
       )
       AND NOT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'ModelVersion'
           AND column_name = 'lmStudioModelName'
       ) THEN
      ALTER TABLE "ModelVersion" RENAME COLUMN "ollamaModelName" TO "lmStudioModelName";
    END IF;
  END $$;
  ```

  Add the same conditional rename as the new post-initial migration so fresh databases receive the current column name. Replace `init.sql` with only `CREATE EXTENSION IF NOT EXISTS vector;`; remove the `init-hnsw.sql` volume mount because backend startup already creates the index after migrations. Set the Docker command to run `npx prisma migrate deploy && node dist/index.js`.

- [ ] **Step 4: Make Compose use real backend secrets instead of weak overrides**

  Preserve `env_file: ./backend/.env`, remove weak `JWT_SECRET` and `ADMIN_TOKEN` defaults from the Compose `environment` block, and document that production values belong in an untracked backend `.env`. Add a production validation check that rejects the known test encryption key without printing it.

- [ ] **Step 5: Make core health independent of optional LoRA availability**

  Add a health contract test that mocks database, Redis, LM Studio, embeddings, and a failed LoRA request. It must assert `200` and `status: 'ok'` when the core services are healthy, while reporting `services.lora: 'unhealthy'`.

  ```ts
  await request(app).get('/health').expect(200).expect((res) => {
    expect(res.body.status).toBe('ok');
    expect(res.body.services.lora).toBe('unhealthy');
  });
  ```

  In `src/index.ts`, keep LoRA in the returned service map but remove it from the condition that sets the overall status to `degraded`. Keep database, Redis, LM Studio, and embeddings as core readiness requirements.

- [ ] **Step 6: Verify fresh and legacy paths without destructive actions**

  Run: `docker compose config --quiet`

  Expected: exit 0.

  Run: `npx prisma migrate status`

  Expected for the current legacy database: a clear pending/adoption state; do not run `migrate deploy` against it before backup and preflight approval.

  Run against an isolated empty PostgreSQL database: `npx prisma migrate deploy`

  Expected: exit 0, then `npx prisma validate` exit 0.

### Task 10: Verify the complete repair and record real measurements

**Files:**
- Modify: `.hermes/plans/2026-07-09_rag-a-to-d.md`

**Interfaces:**
- The completion note reflects actual command output, migration state, and measurements rather than claimed/unrun checks.

- [ ] **Step 1: Run static and test verification**

  Run from `backend`:

  ```powershell
  npx tsc --noEmit --incremental false
  npm test -- --runInBand --ci
  npx prisma validate
  npm run check-schema
  ```

  Run from `frontend`:

  ```powershell
  npx tsc --noEmit --incremental false
  npm run lint
  npm test -- --runInBand --ci
  ```

  Run from repository root: `git diff --check`.

  Expected: all exit 0 and no trailing whitespace/blank-line errors.

- [ ] **Step 2: Run Docker readiness and migration checks**

  Run: `docker compose ps`

  Expected: PostgreSQL, Redis, Docling, embeddings, template service, and backend report healthy; LoRA is reported separately and does not make core RAG health fail when intentionally unavailable.

  Run the safe adoption preflight before altering the legacy database. If it fails, save its exact output in the plan and stop migration mutation until a backup is confirmed.

- [ ] **Step 3: Run real RAG smoke and evaluation measurements**

  With the migration applied only after backup/adoption approval, index one test document with summaries disabled and enabled. Verify no summary query occurs while disabled, then verify exactly one level-0 summary is returned first when enabled. Run:

  ```powershell
  npx tsx src/scripts/evaluate_rag.ts
  $env:ENABLE_QUERY_REWRITER='true'; npx tsx src/scripts/evaluate_rag.ts
  $env:ENABLE_RERANK_FILTER='true'; $env:ENABLE_SELF_CORRECT='true'; npx tsx src/scripts/evaluate_rag.ts
  $env:EVAL_GENERATE='true'; npx tsx src/scripts/evaluate_rag.ts
  ```

  Record actual Recall@5, MRR, faithfulness, and answer relevancy numbers in the plan's Results section. Do not invent numbers for unavailable services.

- [ ] **Step 4: Make the final atomic commit after review**

  Review `git diff` with the user, then stage only the approved RAG repair files and commit with:

  ```powershell
  git add backend frontend docker-compose.yml init.sql README.md .hermes/plans/2026-07-09_rag-a-to-d.md
  git commit -m "fix: complete and harden RAG quality loop"
  ```

  If the legacy database requires adoption, keep the adoption command and backup confirmation outside this code commit.
