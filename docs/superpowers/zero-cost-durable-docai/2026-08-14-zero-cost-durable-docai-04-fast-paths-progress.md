# Zero-Cost Durable DocAI Fast Paths and Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make generation, retrieval, Q&A, PDF processing, rendering, and browser progress bounded, resumable, accessible, and measurably faster without weakening correctness or inventing progress.

**Architecture:** The generation executor becomes a checkpointed pipeline that preserves structured user fields, performs bounded concurrent retrieval, persists drafts before rendering, and publishes only verified staged objects. Q&A keeps one normal streamed answer call. The parser classifies pages with PyMuPDF before selectively invoking OCR/Docling. The browser submits durable jobs and polls ETag-versioned Neon checkpoints with visibility-aware backoff.

**Tech Stack:** TypeScript 7/Jest, Next.js 16/React 19/Vitest, Python 3.11/FastAPI/PyMuPDF/Tesseract/Docling/pytest, .NET 10/Open XML/xUnit, GCS FUSE and Google Cloud Storage metadata API.

**Spec:** `docs/superpowers/zero-cost-durable-docai/2026-08-14-zero-cost-durable-docai-design.md`

## Global Constraints

- Plans 02 and 03 interfaces are inputs; do not rename their job, repository, worker, capacity, or provider contracts.
- Structured input is JSON; never append user fields to prompt prose.
- User-supplied locked or nonblank values cannot be overwritten by profile defaults, deterministic values, field completion, drafting, shortening, or retries.
- Complete fields produce zero field-completion model calls.
- Explicit `docType` or `templateId` forbids command-parser rediscovery; a complete verified template schema forbids a planning call.
- Retrieval uses at most three deterministic query variants, 20 candidates per variant, 40 after deduplication, 8 per document, 12 packed chunks, and 24,000 characters.
- No model-based query rewrite runs by default.
- Generation stages and floors are exact: 2, 5, 10, 15, 25, 40, 65, 80, 90, 97, 100.
- Draft progress stays fixed during unmeasurable model work; no timer advances it.
- A persisted draft is reused after renderer/storage failure; model drafting is not repeated.
- The renderer uses `/tmp/document-renderer/{jobId}`, stages at `abandoned/{jobId}/result.docx`, verifies SHA-256/size, and never edits the mounted original.
- Q&A emits first progress within one second, uses one bounded retrieval phase and one normal streamed answer call, and abstains without an answer call when deterministic evidence is insufficient.
- PDF input is at most 20 MiB, 200 pages, and 100 MiB expanded working data.
- Page classification and full-document OCR rules are copied exactly from design section 13.
- Parser telemetry never contains extracted text.
- Browser polling is immediate, then 3 seconds; after five unchanged versions it backs off to 5, 8, and 10 seconds; it pauses hidden and refreshes immediately when visible.
- Progress is accessible, monotonic, color-independent, and reduced-motion safe.

---

## File Map

- Modify `backend/src/middleware/validation.ts` and tests: structured field bounds.
- Create `backend/src/services/field_completion_service.ts` and tests.
- Modify `backend/src/services/template_generation_service.ts` and tests.
- Create `backend/src/services/retrieval_plan.ts` and tests.
- Create `backend/src/services/durable_generation_pipeline.ts` and tests.
- Modify `backend/src/services/generation_executor.ts`: install the pipeline.
- Modify `backend/src/services/orchestrator.ts`, `self_correct.ts`, `rag_service.ts`, and observability.
- Modify renderer contracts/engine/readiness and tests for staging.
- Modify `backend/src/services/template_service_client.ts` and tests.
- Create `backend/src/services/result_publication_service.ts` and tests.
- Modify `backend/src/routes/qa.ts` and tests.
- Create `backend/src/services/qa_latency.test.ts`.
- Modify Docling service routing/readiness/self-test and add parser fixtures/tests.
- Modify ingestion service/processing worker tests for exact checkpoints and telemetry.
- Create frontend durable-job client, progress model/component, and tests.
- Modify generation page/editor/stage components and proxy allowlist.

---

### Task 1: Preserve Structured Fields and Complete Only Missing Values

**Files:**

- Modify: `backend/src/middleware/validation.ts`
- Modify: `backend/src/middleware/validation.test.ts`
- Create: `backend/src/services/field_completion_service.ts`
- Create: `backend/src/services/field_completion_service.test.ts`
- Modify: `backend/src/services/template_generation_service.ts`
- Modify: `backend/src/services/template_generation_service.test.ts`
- Modify: `backend/src/routes/workflow.ts`

**Interfaces:**

- Consumes: `GenerationJobInput`, provider snapshot resolver, template schema, and user document profile.
- Produces:

~~~typescript
export type FieldValue = string | number | boolean | null;
export interface FieldCompletionInput {
  schema: GenerationSchema;
  submitted: Record<string, FieldValue>;
  lockedFields: ReadonlySet<string>;
  deterministic: Record<string, FieldValue>;
  providerConfigId: string;
  signal: AbortSignal;
}
export interface FieldCompletionResult {
  values: Record<string, FieldValue>;
  missingBeforeModel: string[];
  completionCallCount: 0 | 1;
}
export async function completeMissingFields(
  input: FieldCompletionInput,
  dependencies?: FieldCompletionDependencies,
): Promise<FieldCompletionResult>;
~~~

- [ ] **Step 1: Write failing structured-validation tests**

~~~typescript
it('accepts bounded scalar fields and rejects unknown top-level input', () => {
  expect(parseGenerationInput({
    operationType: 'template_generation',
    prompt: 'Soạn quyết định',
    templateId: TEMPLATE_ID,
    fieldValues: { agencyName: 'Sở Tư pháp', urgent: true, copies: 2 },
    lockedFields: ['agencyName'],
    referenceDocumentIds: [],
  }).fieldValues.agencyName).toBe('Sở Tư pháp');

  expect(() => parseGenerationInput({
    operationType: 'freeform_generation', prompt: 'x', surprise: 'no',
  })).toThrow('Unrecognized key');
});
~~~

Add exact boundary tests for 64 KiB canonical bytes, 16,384-character prompt, 128 keys/locked fields, 128-character keys, 8,192-character strings, 20 references, and unknown/non-scalar values.

- [ ] **Step 2: Write failing merge/call-count tests**

~~~typescript
it('does not call completion when deterministic merge leaves no missing fields', async () => {
  const callModel = jest.fn();
  const result = await completeMissingFields({
    schema: schemaWith('agencyName', 'signatoryName'),
    submitted: { agencyName: 'Người dùng nhập' },
    lockedFields: new Set(['agencyName']),
    deterministic: { agencyName: 'Hồ sơ', signatoryName: 'Nguyễn Văn A' },
    providerConfigId: CONFIG_ID,
    signal: AbortSignal.timeout(1000),
  }, { callModel });
  expect(result.values).toEqual({
    agencyName: 'Người dùng nhập', signatoryName: 'Nguyễn Văn A',
  });
  expect(result.completionCallCount).toBe(0);
  expect(callModel).not.toHaveBeenCalled();
});
~~~

Also prove the model receives only missing field schemas, inferred output cannot overwrite nonblank/locked fields, unknown model keys are rejected, and only one completion call is possible.

- [ ] **Step 3: Run tests and verify failure**

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/middleware/validation.test.ts src/services/field_completion_service.test.ts
~~~

Expected: FAIL because structured bounds and the completion service are absent.

- [ ] **Step 4: Implement deterministic merge and missing-only completion**

Use this precedence:

1. copy submitted fields exactly;
2. fill a blank field from deterministic profile/system values only when it is not locked;
3. compute missing schema fields;
4. return without model call when empty;
5. request one strict structured response containing only missing keys;
6. validate types/known keys;
7. merge only still-missing, unlocked fields.

A locked blank remains blank. Treat only `undefined`, `null`, and an empty string as blank; preserve `false` and `0`.

- [ ] **Step 5: Remove redundant discovery/planning from template generation**

When `templateId` or `docType` exists in the immutable job input, never call `CommandParserAgent.parse`. When a READY template has a valid generation schema and mappings, never call `PlannerAgent`. Validate after deterministic merge and after completion, persist the merged values, and let drafting operate only on fields marked `generatedBody`.

The compatibility `/api/workflow/extract-fields` endpoint calls `completeMissingFields`; it cannot use a separate merge policy.

- [ ] **Step 6: Run and commit**

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/middleware/validation.test.ts src/services/field_completion_service.test.ts src/services/template_generation_service.test.ts src/routes/workflow.contract.test.ts
npm --prefix backend run build
git diff --check
~~~

Expected: all focused tests pass; the complete-field fixture observes zero completion calls.

Commit:

~~~powershell
git add -- backend/src/middleware/validation.ts backend/src/middleware/validation.test.ts backend/src/services/field_completion_service.ts backend/src/services/field_completion_service.test.ts backend/src/services/template_generation_service.ts backend/src/services/template_generation_service.test.ts backend/src/routes/workflow.ts
git commit -m "feat: complete only missing structured fields"
~~~

---

### Task 2: Implement Bounded Retrieval and the Durable Generation Pipeline

**Files:**

- Create: `backend/src/services/retrieval_plan.ts`
- Create: `backend/src/services/retrieval_plan.test.ts`
- Create: `backend/src/services/durable_generation_pipeline.ts`
- Create: `backend/src/services/durable_generation_pipeline.test.ts`
- Modify: `backend/src/services/generation_executor.ts`
- Modify: `backend/src/services/orchestrator.ts`
- Modify: `backend/src/services/self_correct.ts`
- Modify: `backend/src/services/rag_service.ts`
- Modify: `backend/src/services/retrieval_observability.ts`

**Interfaces:**

- Consumes: `GenerationExecutor`, field completion, generation repository checkpoints, provider snapshot, renderer/publication interfaces.
- Produces:

~~~typescript
export interface RetrievalPlan {
  variants: Array<{ kind: 'original' | 'legal_normalized' | 'keyword'; text: string }>;
  perVariantLimit: 20;
  deduplicatedLimit: 40;
  perDocumentLimit: 8;
  packedChunkLimit: 12;
  packedCharacterLimit: 24000;
}
export function buildRetrievalPlan(query: string): RetrievalPlan;
export async function executeRetrievalPlan(
  plan: RetrievalPlan,
  access: AccessScope,
  dependencies?: RetrievalDependencies,
): Promise<PackedEvidence>;

export interface DurableGenerationPipeline {
  execute(job: ClaimedGenerationJob, lease: LeaseContext):
    Promise<GenerationResult>;
}
~~~

- [ ] **Step 1: Write failing retrieval-bound tests**

~~~typescript
it('runs no more than three deterministic variants concurrently and bounds output', async () => {
  const search = jest.fn(async (query: string) => fixtureCandidates(query));
  const result = await executeRetrievalPlan(buildRetrievalPlan(QUESTION), ACCESS, { search });
  expect(search).toHaveBeenCalledTimes(3);
  expect(maxConcurrentCalls(search)).toBeGreaterThan(1);
  expect(result.candidatesBeforePacking).toBeLessThanOrEqual(40);
  expect(result.chunks.length).toBeLessThanOrEqual(12);
  const perDocument = result.chunks.reduce<Record<string, number>>((counts, chunk) => {
    counts[chunk.documentId] = (counts[chunk.documentId] ?? 0) + 1;
    return counts;
  }, {});
  expect(Math.max(0, ...Object.values(perDocument))).toBeLessThanOrEqual(8);
  expect(result.context.length).toBeLessThanOrEqual(24000);
});
~~~

In the test file, `maxConcurrentCalls` is a local helper that increments before each unresolved fake search promise and decrements in `finally`; it returns the recorded peak. This makes the concurrency assertion behavioral rather than timing-based.

Use a test helper rather than nonstandard matchers for per-document counts. Assert stable deduplication by chunk ID/content hash and deterministic tie ordering.

- [ ] **Step 2: Write failing pipeline checkpoint/resume tests**

~~~typescript
it('persists the draft before rendering and reuses it on render retry', async () => {
  const first = pipelineFixture({ rendererFailure: new Error('temporary') });
  await expect(first.pipeline.execute(first.job, first.lease)).rejects.toThrow('temporary');
  expect(first.repository.persistDraft.mock.invocationCallOrder[0])
    .toBeLessThan(first.renderer.render.mock.invocationCallOrder[0]);

  const retry = pipelineFixture({ persistedDraft: first.persistedDraft });
  await retry.pipeline.execute(retry.job, retry.lease);
  expect(retry.model.draft).not.toHaveBeenCalled();
  expect(retry.renderer.render).toHaveBeenCalledTimes(1);
});
~~~

Also assert exact stage floors, no timer checkpoints, cancellation before every external/irreversible call, provider/model snapshot use, reference readiness, one retrieval phase, one draft call, result publication once, and no generic self-correction regeneration.

- [ ] **Step 3: Run tests and verify failure**

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/services/retrieval_plan.test.ts src/services/durable_generation_pipeline.test.ts
~~~

Expected: FAIL because the new bounded services are absent.

- [ ] **Step 4: Implement deterministic variants and packing**

Variants are:

1. trimmed original query;
2. deterministic Vietnamese legal normalization using lowercasing, Unicode normalization, whitespace collapse, and the project's existing legal synonym map;
3. deterministic keyword form removing stop words while preserving dates, monetary values, document numbers, named entities, and quoted phrases.

Deduplicate by chunk ID first, then content hash. Fuse ranks deterministically, cap each document at eight, and pack at most 12 chunks/24,000 characters without splitting a chunk.

Observability records only query-embedding, lookup, fusion, packing, and total duration plus counts; it never logs query/evidence text.

- [ ] **Step 5: Implement the checkpointed pipeline**

Execute:

| Completed durable action | Checkpoint |
|---|---:|
| worker claimed | `worker_claimed`, 10 |
| owner/template/references loaded | `preparing_references`, 15 |
| merged/completed fields persisted | `filling_fields`, 25 |
| packed evidence persisted by IDs | `retrieving`, 40 |
| completed draft persisted | `drafting`, 65 |
| structural validation summary persisted | `validating`, 80 |
| staged render verified | `rendering`, 90 |
| final object verified | `saving`, 97 |
| conditional DB completion | `succeeded`, 100 |

Before and after each provider, retrieval, renderer, object-copy, and completion call, run `assertLease` and `assertNotCancelled`, and pass `lease.signal` into every client that supports cancellation. An aborted client result may never checkpoint or publish. Persist stage timings in bounded JSON. Store draft at most 512 KiB UTF-8 and reject a larger provider response as terminal `DRAFT_TOO_LARGE`.

- [ ] **Step 6: Install the pipeline behind GenerationExecutor**

`generation_executor.ts` constructs `DurableGenerationPipeline` and delegates without changing the worker-facing signature. Delete old automatic `shouldRegenerate` calls from generation. A renderer length request may cause one field-specific shortening call in Task 3; no validation-driven redraft is allowed.

- [ ] **Step 7: Run and commit**

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/services/retrieval_plan.test.ts src/services/durable_generation_pipeline.test.ts src/services/orchestrator.test.ts src/services/rag_service.test.ts src/services/retrieval_observability.test.ts
npm --prefix backend run build
git diff --check
~~~

Expected: all tests pass; retry fixture performs no second draft call.

Commit:

~~~powershell
git add -- backend/src/services/retrieval_plan.ts backend/src/services/retrieval_plan.test.ts backend/src/services/durable_generation_pipeline.ts backend/src/services/durable_generation_pipeline.test.ts backend/src/services/generation_executor.ts backend/src/services/orchestrator.ts backend/src/services/self_correct.ts backend/src/services/rag_service.ts backend/src/services/retrieval_observability.ts
git commit -m "feat: add bounded resumable generation pipeline"
~~~

---

### Task 3: Stage, Verify, and Conditionally Publish Rendered Documents

**Files:**

- Modify: `document-renderer/src/DocumentRenderer.Core/Contracts/RendererContracts.cs`
- Modify: `document-renderer/src/DocumentRenderer.Core/Configuration/RendererOptions.cs`
- Modify: `document-renderer/src/DocumentRenderer.Core/Rendering/DocumentRenderEngine.cs`
- Modify: `document-renderer/src/DocumentRenderer.Core/Rendering/RendererReadiness.cs`
- Modify: `document-renderer/src/DocumentRenderer.Api/Program.cs`
- Create: `document-renderer/tests/DocumentRenderer.Tests/RendererReadinessTests.cs`
- Modify: `document-renderer/tests/DocumentRenderer.Tests/RendererCoreTests.cs`
- Modify: `backend/src/services/template_service_client.ts`
- Modify: `backend/src/services/template_service_client.test.ts`
- Create: `backend/src/services/result_publication_service.ts`
- Create: `backend/src/services/result_publication_service.test.ts`
- Modify: `backend/src/services/durable_generation_pipeline.ts`
- Modify: `backend/src/services/durable_generation_pipeline.test.ts`

**Interfaces:**

- Consumes: job ID, immutable template, semantic values, mappings, lease/cancellation, object identity service, and repository conditional completion.
- Produces:

~~~csharp
public sealed record RenderDocumentRequest(
    string JobId,
    string TemplateId,
    string OwnerId,
    string DocumentId,
    string RelativePath,
    IReadOnlyDictionary<string, object?> Values,
    IReadOnlyList<FieldLocator> Mappings);

public sealed record RenderDocumentResponse(
    bool Success,
    string? StagingRelativePath,
    string? OutputSha256,
    long? OutputSize,
    FidelityReport FidelityReport,
    ShortenRequest? ShortenRequired = null);
~~~

~~~typescript
export interface ResultPublicationService {
  publish(input: {
    jobId: string;
    ownerId: string;
    documentId: string;
    stagingKey: string;
    sha256: string;
    size: number;
    lease: LeaseContext;
  }): Promise<{ finalKey: string; sha256: string; size: number }>;
  abandonFinal(input: {
    jobId: string; finalKey: string; generation: string;
  }): Promise<void>;
}
~~~

- [ ] **Step 1: Write failing renderer staging/isolation tests**

~~~csharp
[Fact]
public async Task Render_UsesJobLocalTempAndStagesUnderAbandonedPrefix()
{
    var request = Fixture.RenderRequest(jobId: JobId, ownerId: OwnerId, documentId: DocumentId);
    var response = await Fixture.Engine.RenderAsync(request, CancellationToken.None);
    Assert.Equal($"abandoned/{JobId}/result.docx", response.StagingRelativePath);
    Assert.Matches("^[a-f0-9]{64}$", response.OutputSha256);
    Assert.False(File.Exists(Fixture.OriginalPath + ".tmp"));
    var expectedRoot = Path.GetFullPath(Path.Combine(Fixture.TempRoot, JobId));
    Assert.True(Fixture.Paths.AllTemporaryPaths.All(
        path => Path.GetFullPath(path).StartsWith(
            expectedRoot + Path.DirectorySeparatorChar,
            StringComparison.Ordinal)));
}
~~~

Add tests that template hash remains unchanged, concurrent jobs never share a temp directory, cancellation deletes local temp, capability probes run once per process, and no final `generated/` path is written by the renderer. Malicious fixtures prove rejection of ZIP parent traversal, excessive entry/expanded-byte limits, macros, encrypted entries, and external OOXML relationships before extraction or render.

- [ ] **Step 2: Run and verify failure**

Run:

~~~powershell
dotnet test document-renderer/DocumentRenderer.sln --filter "RendererCoreTests|RendererReadinessTests"
~~~

Expected: FAIL because the renderer currently writes directly to `generated/`.

- [ ] **Step 3: Implement local-copy and staging behavior**

Add a `RendererOptions.TempRoot` whose production/container default is `/tmp/document-renderer` and whose tests use an isolated platform-native temporary directory. Resolve the immutable original, copy it into `{TempRoot}/{jobId}/working.docx`, edit and validate locally, compute SHA-256/size, then copy the verified package to `abandoned/{jobId}/result.docx`. Clean the entire exact job temp directory in `finally`. The container smoke asserts the resolved production path begins with `/tmp/document-renderer/{jobId}/`.

Readiness caches LibreOffice, Poppler, font, and writable-temp checks once per process. It does not perform a real render.

- [ ] **Step 4: Write failing backend publication/race tests**

~~~typescript
it('exposes the final key only after copy verification and DB completion', async () => {
  const service = createResultPublicationService(storage, repository);
  storage.copyAndStat.mockResolvedValue({
    generation: '2', sha256: SHA, size: 4096,
  });
  repository.complete.mockResolvedValue('completed');
  const result = await service.publish(input);
  expect(storage.copyAndStat).toHaveBeenCalledWith(
    `abandoned/${JOB_ID}/result.docx`,
    `generated/${OWNER_ID}/${DOCUMENT_ID}.docx`,
  );
  expect(storage.copyAndStat.mock.invocationCallOrder[0])
    .toBeLessThan(repository.complete.mock.invocationCallOrder[0]);
  expect(result.finalKey).toBe(`generated/${OWNER_ID}/${DOCUMENT_ID}.docx`);
});
~~~

Assert checksum/size mismatch is transient failure; cancellation/lease loss after copy removes the exact final generation or leaves it under abandoned fallback; result ID is never exposed; successful completion schedules staging cleanup.

- [ ] **Step 5: Implement publication and one shortening retry**

The backend verifies the renderer staging contract, copies through the Storage API, verifies final generation/size/SHA, then calls the repository conditional completion. If completion returns `cancelled` or `lease_lost`, delete the exact final generation and retain no DB result pointer.

If the first valid renderer response contains one verified `shorten_required`, call the model once for only that field with the character limit and render once more. If shortening or the second render fails, publish the first valid staging result with a warning. Never perform a third render.

- [ ] **Step 6: Run and commit**

Run:

~~~powershell
dotnet test document-renderer/DocumentRenderer.sln
npm --prefix backend test -- --runInBand src/services/template_service_client.test.ts src/services/result_publication_service.test.ts src/services/durable_generation_pipeline.test.ts
npm --prefix backend run build
pwsh -NoProfile -File ops/test-renderer-container.ps1
git diff --check
~~~

Expected: all renderer/backend tests, build, and container smoke pass.

Commit:

~~~powershell
git add -- document-renderer/src/DocumentRenderer.Core/Contracts/RendererContracts.cs document-renderer/src/DocumentRenderer.Core/Configuration/RendererOptions.cs document-renderer/src/DocumentRenderer.Core/Rendering/DocumentRenderEngine.cs document-renderer/src/DocumentRenderer.Core/Rendering/RendererReadiness.cs document-renderer/src/DocumentRenderer.Api/Program.cs document-renderer/tests/DocumentRenderer.Tests/RendererReadinessTests.cs document-renderer/tests/DocumentRenderer.Tests/RendererCoreTests.cs backend/src/services/template_service_client.ts backend/src/services/template_service_client.test.ts backend/src/services/result_publication_service.ts backend/src/services/result_publication_service.test.ts backend/src/services/durable_generation_pipeline.ts backend/src/services/durable_generation_pipeline.test.ts
git commit -m "feat: stage and conditionally publish rendered results"
~~~

---

### Task 4: Reduce Q&A to One Normal Answer Call

**Files:**

- Modify: `backend/src/routes/qa.ts`
- Modify: `backend/src/routes/qa.contract.test.ts`
- Modify: `backend/src/services/self_correct.ts`
- Modify: `backend/src/services/self_correct.test.ts`
- Modify: `backend/src/services/context_filter.ts`
- Modify: `backend/src/services/context_filter.test.ts`
- Modify: `backend/src/services/query_rewriter.ts`
- Modify: `backend/src/services/query_rewriter.test.ts`
- Create: `backend/src/services/qa_latency.test.ts`
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/app/(app)/qa/page.tsx`
- Modify: `frontend/test/qa-page.test.tsx`
- Modify: `frontend/test/qa-cancellation.test.tsx`

**Interfaces:**

- Consumes: `RetrievalPlan`, provider configuration, SSE writer, owned evidence chunks.
- Produces:

~~~typescript
export interface EvidenceSufficiency {
  sufficient: boolean;
  reason: 'enough' | 'no_chunks' | 'weak_single_support';
}
export function assessEvidenceSufficiency(
  chunks: ContextChunk[],
  keywordQuery: string,
): EvidenceSufficiency;
export function requiresFaithfulnessCheck(
  answer: string,
  evidence: ContextChunk[],
): boolean;

// frontend/lib/api.ts
export type QAStreamEvent =
  | { type: 'progress'; stage: 'retrieving' | 'answering' | 'verifying' }
  | { type: 'answer_delta'; text: string; provisional: true }
  | { type: 'verification_started' }
  | { type: 'answer_final'; answer: string; citations: QASource[];
      verification: 'not_required' | 'passed' }
  | { type: 'answer_retracted'; message: string }
  | { type: 'error'; code: string; message: string };
~~~

- [ ] **Step 1: Write failing call-count and timing tests**

~~~typescript
it('uses one retrieval phase and one streamed answer call on the normal path', async () => {
  const response = await askQuestion(app, ownedQuestion);
  expect(response.status).toBe(200);
  expect(retrieval.execute).toHaveBeenCalledTimes(1);
  expect(llm.stream).toHaveBeenCalledTimes(1);
  expect(llm.complete).not.toHaveBeenCalled();
  expect(firstSseEvent(response).stage).toBe('retrieving');
});

it('abstains without an answer-model call when evidence is insufficient', async () => {
  retrieval.execute.mockResolvedValue({ chunks: [], context: '' });
  const response = await askQuestion(app, ownedQuestion);
  expect(response.text).toContain('không đủ căn cứ');
  expect(llm.stream).not.toHaveBeenCalled();
});
~~~

Use a controllable clock to assert the first SSE progress event is flushed within one second, retrieval timeout at 15 seconds, provider timeout at four minutes, and total timeout at five minutes.

- [ ] **Step 2: Run and verify failure**

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/routes/qa.contract.test.ts src/services/qa_latency.test.ts
~~~

Expected: FAIL because the current path can self-correct/regenerate.

- [ ] **Step 3: Implement deterministic sufficiency**

Evidence is insufficient when no chunks exist, or when fewer than two distinct chunks remain and no chunk has normalized lexical overlap at least 0.25 with the deterministic keyword query. Tokenize with the same Vietnamese normalization used by retrieval; do not call a model.

- [ ] **Step 4: Implement the exact one-call normal path**

Flush headers and `{ stage: "retrieving" }` first. Enforce the 4,096-character question limit. Execute one `RetrievalPlan`, assess sufficiency, then make one streamed answer call using the selected evidence. Citations must reference only selected owned chunk IDs.

Remove default model query rewriting and duplicate `shouldRegenerate` calls. Never synchronously regenerate an answer.

- [ ] **Step 5: Implement one conditional faithfulness call**

Return `true` only when the answer contains a concrete date, monetary value, document number, or quoted legal duty absent verbatim from evidence, or cites an evidence ID outside the selected set. Stream deltas as `provisional: true`. When the trigger is false, finish with `answer_final`. When true, emit `verification_started`, perform one nonstreaming check, and emit either `answer_final` or `answer_retracted`; timeout/error retracts. Never persist a provisional answer, regenerate, or perform a second check.

Update the frontend SSE parser and Q&A page so provisional text is visibly labeled `Đang kiểm chứng`, becomes ordinary answer text only on `answer_final`, and is cleared atomically on `answer_retracted` in favor of `Không đủ căn cứ để trả lời chắc chắn.` Add frontend tests for finalization, retraction, checker failure, abort, and an explicit retry making one new request.

- [ ] **Step 6: Run and commit**

Run:

~~~powershell
npm --prefix backend test -- --runInBand src/routes/qa.contract.test.ts src/services/qa_latency.test.ts src/services/self_correct.test.ts src/services/context_filter.test.ts src/services/query_rewriter.test.ts
npm --prefix backend run build
npm --prefix frontend test -- --run test/qa-page.test.tsx test/qa-cancellation.test.tsx
npm --prefix frontend run typecheck
git diff --check
~~~

Expected: tests pass; normal fixture reports one answer call and zero faithfulness calls.

Commit:

~~~powershell
git add -- backend/src/routes/qa.ts backend/src/routes/qa.contract.test.ts backend/src/services/self_correct.ts backend/src/services/self_correct.test.ts backend/src/services/context_filter.ts backend/src/services/context_filter.test.ts backend/src/services/query_rewriter.ts backend/src/services/query_rewriter.test.ts backend/src/services/qa_latency.test.ts frontend/lib/api.ts 'frontend/app/(app)/qa/page.tsx' frontend/test/qa-page.test.tsx frontend/test/qa-cancellation.test.tsx
git commit -m "perf: bound Q&A to one normal answer call"
~~~

---

### Task 5: Route PDFs Page-by-Page Before OCR or Docling

**Files:**

- Modify: `docling-service/main.py`
- Modify: `docling-service/self_test.py`
- Create: `docling-service/tests/test_parser_routing.py`
- Modify: `docling-service/tests/test_upload_isolation.py`
- Create: `docling-service/tests/fixtures/searchable.pdf`
- Create: `docling-service/tests/fixtures/mixed.pdf`
- Create: `docling-service/tests/fixtures/scanned.pdf`
- Create: `docling-service/tests/fixtures/complex-table.pdf`
- Modify: `backend/src/services/ingestion_service.ts`
- Modify: `backend/src/services/ingestion_service.test.ts`
- Modify: `backend/src/services/processing_job_worker.ts`
- Modify: `backend/src/services/processing_job_worker.test.ts`

**Interfaces:**

- Consumes: immutable PDF object and processing lease/checkpoints.
- Produces:

~~~python
class PageClass(str, Enum):
    CLEAN = "clean"
    UNCERTAIN = "uncertain"
    UNUSABLE = "unusable"

@dataclass(frozen=True)
class PageQuality:
    page_number: int
    classification: PageClass
    letter_digit_count: int
    replacement_ratio: float
    control_ratio: float
    max_repeated_glyph_ratio: float
    multi_character_token_count: int

def classify_page(page_number: int, text: str) -> PageQuality: ...
def select_parser_route(analysis: DocumentAnalysis) -> ParserRoute: ...
~~~

Response metadata includes parser route, page count, clean/uncertain/unusable counts, OCR page numbers/count, table count, structural-recovery pages, skipped-OCR reason, and per-stage duration.

- [ ] **Step 1: Generate deterministic fixture PDFs and write failing routing tests**

Fixtures are committed, small, and contain no private data. Tests inject spies:

~~~python
def test_searchable_pdf_never_calls_ocr_or_docling(parser, searchable_pdf):
    result = parser.parse(searchable_pdf)
    assert result.metadata["ocrPageNumbers"] == []
    assert result.metadata["parserRoute"] == "pymupdf_text"
    parser.ocr_page.assert_not_called()
    parser.docling_recover.assert_not_called()

def test_mixed_pdf_ocrs_only_uncertain_or_unusable_pages(parser, mixed_pdf):
    result = parser.parse(mixed_pdf)
    assert result.metadata["ocrPageNumbers"] == [2]
    assert [call.args[0] for call in parser.ocr_page.call_args_list] == [2]
~~~

Add scanned and complex-table cases plus fixed Vietnamese, English, mixed-language, malformed-font, and blank classification strings.

- [ ] **Step 2: Run and verify failure**

Run:

~~~powershell
python -m pytest docling-service/tests/test_parser_routing.py -q
~~~

Expected: FAIL because Docling-first routing remains.

- [ ] **Step 3: Implement exact classification**

Normalize Unicode first. Clean requires all:

- at least 80 letter/digit characters;
- replacement ratio at most 0.01;
- control ratio at most 0.01;
- repeated-glyph ratio at most 0.30;
- at least three tokens with two or more letters/digits.

Unusable means fewer than 20 letter/digit characters, replacement ratio above 0.05, or control ratio above 0.05. Everything else is uncertain. OCR uncertain/unusable pages only.

Enforce compressed size 20 MiB before saving, PDF signature/MIME agreement, page count 200 after open, and cumulative rendered/OCR working bytes 100 MiB. Reject encrypted/password-protected PDFs, embedded files, active-content actions, and invalid cross-reference structures that exceed the bounded open/repair path. Run the parser non-root in the job-local temporary directory, image-bake required artifacts, and make no outbound fetch from the parser path.

- [ ] **Step 4: Implement structural recovery and full-OCR gate**

Run Docling without OCR only for pages with a detected table of at least 2x2 or at least two geometric text columns whose reading order differs from extraction order.

Full-document OCR is disabled by default. Enable only through an immutable benchmark evidence hash when at least 80% of a document with 10 or more pages is unusable and the accepted fixture benchmark proves it faster without accuracy reduction. Otherwise OCR selected pages.

- [ ] **Step 5: Fix readiness and build self-test**

`/ready` checks imports, pinned artifacts, and writable temp only. It never converts. `self_test.py` performs one no-OCR real conversion during Docker build and records package/revision/checksum evidence.

Remove exception details/document text from HTTP 500 responses and logs. Telemetry contains only bounded counts, page numbers, routes, codes, and durations.

- [ ] **Step 6: Map parser progress to durable processing checkpoints**

Processing checkpoints:

| Durable action | Stage/floor |
|---|---|
| PDF opened and limits passed | `checking_pdf`, 10 |
| text layer extracted | `extracting_text`, 20 |
| each selected OCR page persisted in working result | `ocr_pages`, 35 with page units |
| structural pages recovered | `structural_recovery`, 50 |
| deterministic chunks prepared | `chunking`, 65 with chunk units |
| embeddings produced | `embedding`, 80 with chunk units |
| chunks/document atomically persisted | `persisting`, 95 |
| transaction complete | `ready`, 100 |

Template processing uses `analyzing_template` 20, `generating_preview` 60, `persisting` 95, `ready` 100.

- [ ] **Step 7: Run and commit**

Run:

~~~powershell
python -m pytest docling-service/tests -q
python -m compileall -q docling-service
npm --prefix backend test -- --runInBand src/services/ingestion_service.test.ts src/services/processing_job_worker.test.ts
npm --prefix backend run build
git diff --check
~~~

Expected: all tests/build pass; searchable fixture reports zero OCR and zero Docling calls.

Commit:

~~~powershell
git add -- docling-service/main.py docling-service/self_test.py docling-service/tests/test_parser_routing.py docling-service/tests/test_upload_isolation.py docling-service/tests/fixtures/searchable.pdf docling-service/tests/fixtures/mixed.pdf docling-service/tests/fixtures/scanned.pdf docling-service/tests/fixtures/complex-table.pdf backend/src/services/ingestion_service.ts backend/src/services/ingestion_service.test.ts backend/src/services/processing_job_worker.ts backend/src/services/processing_job_worker.test.ts
git commit -m "perf: route PDFs before OCR and Docling"
~~~

---

### Task 6: Switch the Browser to Durable Jobs and Honest Progress

**Files:**

- Modify: `frontend/types/api.ts`
- Modify: `frontend/lib/api.ts`
- Create: `frontend/lib/generation-jobs.ts`
- Create: `frontend/test/generation-jobs.test.ts`
- Create: `frontend/lib/ui/job-progress.ts`
- Create: `frontend/lib/ui/job-progress.test.ts`
- Create: `frontend/components/feature/GenerationProgressCard.tsx`
- Create: `frontend/test/generation-progress-card.test.tsx`
- Modify: `frontend/app/(app)/generate/page.tsx`
- Modify: `frontend/components/feature/GenerationStages.tsx`
- Modify: `frontend/lib/ui/generation-stage.ts`
- Modify: `frontend/components/StreamingDocumentEditor.tsx`
- Modify: `frontend/app/api/proxy/[...path]/route.ts`
- Modify: `frontend/test/proxy-policy.test.ts`
- Create: `frontend/test/generate-page-fast-path.test.tsx`
- Modify: `frontend/test/generation-cancellation.test.tsx`

**Interfaces:**

- Consumes: generation/processing status APIs and provider safe summaries.
- Produces:

~~~typescript
export interface JobProgressView {
  id: string;
  kind: 'generation' | 'processing';
  state: JobState;
  label: string;
  confirmedPercent: number;
  current: number | null;
  total: number | null;
  version: number;
  providerLabel: string | null;
  model: string | null;
  processingSummary: ProcessingJobView['parserSummary'];
  errorMessage: string | null;
  actions: Array<'cancel' | 'retry' | 'open' | 'download'>;
}

export interface PollScheduleState {
  unchangedCount: number;
  visible: boolean;
}
export function nextPollDelay(state: PollScheduleState): 3000 | 5000 | 8000 | 10000 | null;
~~~

- [ ] **Step 1: Write failing poll/model tests**

~~~typescript
it.each([
  [0, 3000], [4, 3000], [5, 5000], [6, 8000], [7, 10000], [20, 10000],
] as const)('backs off after unchanged count %s', (unchangedCount, expected) => {
  expect(nextPollDelay({ unchangedCount, visible: true })).toBe(expected);
});

it('never regresses a confirmed checkpoint', () => {
  const previous = jobView({ version: 4, confirmedPercent: 65 });
  const stale = serverJob({ progressVersion: 3, confirmedProgress: 40 });
  expect(mergeJobProgress(previous, stale)).toBe(previous);
});
~~~

Assert hidden returns null, visibility return triggers immediate fetch, malformed percentages clamp but do not advance, and ETag 304 increments unchanged count without replacing data.

- [ ] **Step 2: Write failing component/page tests**

Cover accepted/waiting/claimed/all generation stages, processing stages, disconnect/reconnect, refresh from session route state, explicit cancellation, provider-selected retry, terminal failure, completed open/download, keyboard operation, `role=progressbar`, ARIA values, polite stage announcements only, reduced motion, long Vietnamese copy, and no exact ETA/queue position.

The central test:

~~~tsx
it('does not cancel when the page unmounts or the browser request aborts', async () => {
  const { unmount } = render(<GeneratePage />);
  await submitGeneration();
  unmount();
  expect(cancelGenerationJob).not.toHaveBeenCalled();
});
~~~

- [ ] **Step 3: Run and verify failure**

Run:

~~~powershell
npm --prefix frontend test -- --run test/generation-jobs.test.ts lib/ui/job-progress.test.ts test/generation-progress-card.test.tsx test/generate-page-fast-path.test.tsx test/generation-cancellation.test.tsx
~~~

Expected: FAIL because durable polling/progress components are absent.

- [ ] **Step 4: Implement typed submission and polling**

Generate one stable UUID idempotency key per user submission, store returned job ID in the route and `sessionStorage`, and resume only after owner-scoped GET succeeds.

Send `If-None-Match` with the last progress version. Poll immediately, then use exact delays. Pause hidden; on visibility change to visible fetch immediately. Preserve the last confirmed checkpoint on transport error and show `Đang kết nối lại…`.

- [ ] **Step 5: Implement accessible truthful progress**

Render:

~~~tsx
<div
  role="progressbar"
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={job.confirmedPercent}
  aria-label={job.label}
/>
<p aria-live="polite">{announcedStageLabel}</p>
~~~

Do not announce every poll. Keep width fixed during drafting and show non-percent activity. Under `prefers-reduced-motion: reduce`, remove continuous animation. Preserve the four-step `GenerationStages` workflow above the active job card.

Use the exact Vietnamese labels in design section 23 and `Bạn có thể rời trang; công việc vẫn tiếp tục.`

- [ ] **Step 6: Wire uploads, generation, results, and proxy policy**

After upload, poll `ProcessingJob` until ready, showing parser stages and `Đã nhận dạng lớp văn bản — bỏ qua OCR` only when telemetry proves it. Submit generation only after every reference is ready.

Stop routing the generation page through `/workflow/stream`. On success fetch/open/download by `resultDocumentId`; never receive base64 DOCX over SSE. Cancellation occurs only from the explicit button.

Allow exact BFF paths/methods:

~~~text
generation-jobs                     POST
generation-jobs/{id}                GET
generation-jobs/{id}/cancel         POST
generation-jobs/{id}/retry          POST
generation-jobs/{id}/reconcile-dispatch POST
processing-jobs/{id}                GET
processing-jobs/{id}/cancel         POST
processing-jobs/{id}/reconcile-dispatch POST
rag/upload                          POST
~~~

- [ ] **Step 7: Run visual/accessibility test matrix and commit**

Run:

~~~powershell
npm --prefix frontend test -- --run test/generation-jobs.test.ts lib/ui/job-progress.test.ts test/generation-progress-card.test.tsx test/generate-page-fast-path.test.tsx test/generation-cancellation.test.tsx test/proxy-policy.test.ts
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
git diff --check
~~~

Expected: tests/typecheck/lint/build pass. Manually capture 360, 768, 1024, and 1440 px layouts at 100% and 200% zoom in light/dark and reduced-motion modes during Plan 06 acceptance.

Commit:

~~~powershell
git add -- frontend/types/api.ts frontend/lib/api.ts frontend/lib/generation-jobs.ts frontend/test/generation-jobs.test.ts frontend/lib/ui/job-progress.ts frontend/lib/ui/job-progress.test.ts frontend/components/feature/GenerationProgressCard.tsx frontend/test/generation-progress-card.test.tsx 'frontend/app/(app)/generate/page.tsx' frontend/components/feature/GenerationStages.tsx frontend/lib/ui/generation-stage.ts frontend/components/StreamingDocumentEditor.tsx 'frontend/app/api/proxy/[...path]/route.ts' frontend/test/proxy-policy.test.ts frontend/test/generate-page-fast-path.test.tsx frontend/test/generation-cancellation.test.tsx
git commit -m "feat: show durable honest job progress"
~~~

## Plan 04 Exit Gate

Run the master Plan Task 4 command. Additionally inspect call-count evidence:

- complete-field template fixture: zero completion calls;
- standard generation: one retrieval phase and one draft call;
- renderer retry: no second draft call;
- normal Q&A: one retrieval phase and one answer call;
- insufficient Q&A: zero answer calls;
- searchable PDF: zero OCR and zero Docling calls;
- mixed PDF: OCR only classified pages;
- all displayed percentages equal persisted checkpoints.
