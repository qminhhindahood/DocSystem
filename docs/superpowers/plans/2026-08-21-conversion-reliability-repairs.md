# Conversion Reliability Repairs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct six extraction, quota, retention, error-contract, and confidence defects with regression coverage.

**Architecture:** Keep orchestration in `pipeline.py`, move table conversion and artifact lifecycle into focused modules, and preserve the existing HTTP schema. Use Redis optimistic transactions for quota and explicit page-only PDFs for Gemini batches.

**Tech Stack:** Python 3.11, PyMuPDF, python-docx, FastAPI, redis-py, fakeredis, pytest.

**Spec:** `docs/superpowers/specs/2026-08-21-conversion-reliability-repairs-design.md`

## Global Constraints

- Keep the public conversion HTTP schema unchanged.
- Preserve special `IntakeError` and `VisionAuthError` user messages.
- Never expose BYOK keys or raw unexpected exceptions.
- Use `FILE_TTL_S` for DOCX and job-media retention.
- Work inline on the current branch; repository instructions prohibit subagents unless explicitly requested.

---

### Task 1: Atomic quota admission

**Files:**
- Modify: `conversion-service/quota.py`
- Test: `conversion-service/tests/test_quota_refund_on_failure.py`

**Interfaces:**
- Consumes: redis-py clients supporting `pipeline()`, `watch()`, `multi()`, and `execute()`.
- Produces: unchanged `QuotaService.check_and_increment(user_id) -> tuple[bool, int]` and `refund(user_id) -> None`.

- [ ] Add tests proving repeated denied Redis and memory requests leave the stored count at the limit, and a refund immediately reopens one slot.
- [ ] Run the focused tests and confirm the stored count exceeds the limit before implementation.
- [ ] Add a lock for memory state and a Redis optimistic-transaction loop that returns before `MULTI` when the current count is at the limit.
- [ ] Make refund atomically decrement only a positive counter.
- [ ] Run `python -m pytest tests/test_quota_refund_on_failure.py -q` and confirm green.

### Task 2: Real table extraction

**Files:**
- Create: `conversion-service/structuring/tables.py`
- Modify: `conversion-service/triage/triage.py`
- Modify: `conversion-service/pipeline.py`
- Modify: `conversion-service/render/docx_builder.py`
- Test: `conversion-service/tests/test_table_extraction.py`

**Interfaces:**
- Consumes: PyMuPDF `Table.extract()`, `Table.rows`, `Table.header`, `Table.bbox`, and body `LineInfo` values.
- Produces: `extract_accepted_tables(page, page_number) -> tuple[list[DetectedTable], int]`, where each `DetectedTable` carries a `TableBlock` and its PDF bbox.

- [ ] Add a real-PDF regression test whose grid becomes one non-layout Word table, preserves headers/data, and emits each cell exactly once; add a rejected sparse-grid fallback test.
- [ ] Run the new file and confirm the Word-table assertion fails before implementation.
- [ ] Change `table_quality_gate()` to require `table.col_count >= TABLE_MIN_COLUMNS` and a textual non-empty ratio from `table.extract()`.
- [ ] Implement `DetectedTable`, normalize cell text, infer colspans/rowspans from unique geometry boundaries, map internal/external headers into `TableBlock` rows, and make the DOCX renderer skip grid positions occupied by row spans.
- [ ] In `TABLE_HEAVY`, exclude accepted-table lines, interleave structured line segments and tables by y-position, and add a status warning when all detections are rejected.
- [ ] Run `python -m pytest tests/test_table_extraction.py tests/test_triage.py tests/test_fidelity.py -q` and confirm green.

### Task 3: Isolated Gemini batches

**Files:**
- Modify: `conversion-service/vision/gemini_contract.py`
- Modify: `conversion-service/pipeline.py`
- Test: `conversion-service/tests/test_vision_wiring.py`

**Interfaces:**
- Consumes: original PDF bytes and explicit 1-based original page numbers.
- Produces: `plan_batches(page_numbers) -> list[tuple[int, ...]]` and Gemini calls containing only each tuple's pages.

- [ ] Add tests proving `[1, 3]` remains one explicit `(1, 3)` batch, the request PDF has two pages, its prompt maps them to originals, and page-2 output is discarded.
- [ ] Run the focused tests and confirm range planning/full-PDF behavior fails them.
- [ ] Assemble a batch PDF with PyMuPDF `insert_pdf`, update the prompt and client methods to accept explicit original pages, and pass isolated bytes in parallel calls.
- [ ] Filter validated blocks to the batch's allowed page set and degrade allowed pages missing from otherwise valid output.
- [ ] Run `python -m pytest tests/test_vision_wiring.py -q` and confirm green.

### Task 4: Artifact retention

**Files:**
- Create: `conversion-service/artifact_cleanup.py`
- Modify: `conversion-service/config.py`
- Modify: `conversion-service/worker.py`
- Modify: `conversion-service/main.py`
- Test: `conversion-service/tests/test_artifact_cleanup.py`

**Interfaces:**
- Produces: `mark_job_artifacts_complete(job_id)`, `delete_job_artifacts(job_id)`, and `cleanup_expired_artifacts(now=None) -> int`.
- Consumes: exact job paths under configured output/media roots and `FILE_TTL_S`.

- [ ] Add tests with fresh/expired DOCX files and media directories proving only expired job-scoped artifacts are removed; add an in-process source cleanup test.
- [ ] Run the new file and confirm imports/retention assertions fail.
- [ ] Implement safe exact-path deletion, completion timestamp touches, and mtime-based sweeps.
- [ ] Start a periodic async sweep in the API lifecycle and a monotonic-interval sweep in the worker loop; mark successful artifacts at completion.
- [ ] Add source removal to the in-process runner's `finally` block.
- [ ] Run `python -m pytest tests/test_artifact_cleanup.py tests/test_queue_durability.py -q` and confirm green.

### Task 5: Safe failure contract

**Files:**
- Create: `conversion-service/user_errors.py`
- Modify: `conversion-service/worker.py`
- Modify: `conversion-service/main.py`
- Test: `conversion-service/tests/test_safe_errors.py`
- Test: `conversion-service/tests/test_vision_wiring.py`

**Interfaces:**
- Produces: `UNEXPECTED_CONVERSION_ERROR` stable Vietnamese string.
- Consumes: worker/in-process exception boundaries with full correlated logging.

- [ ] Add worker and in-process tests raising an internal path-bearing exception and assert the stored state contains only the safe message; assert Gemini auth keeps its special message.
- [ ] Run the focused tests and confirm raw exception text is currently stored.
- [ ] Store `UNEXPECTED_CONVERSION_ERROR` for generic exceptions, log with `jobId`, and add the missing in-process `VisionAuthError` branch.
- [ ] Run `python -m pytest tests/test_safe_errors.py tests/test_vision_wiring.py -q` and confirm green.

### Task 6: Document confidence warning

**Files:**
- Modify: `conversion-service/pipeline.py`
- Test: `conversion-service/tests/test_fidelity.py`

**Interfaces:**
- Consumes: computed `ConversionReport.confidence` and `config.DOC_WARN_THRESHOLD`.
- Produces: `completed_with_warnings` plus a threshold warning for non-failed low-confidence documents.

- [ ] Add a conversion-level test that forces high coverage but confidence below 0.8 and asserts warning status/text; add a failed-status precedence assertion.
- [ ] Run the focused test and confirm low confidence is reported as completed before implementation.
- [ ] Apply the threshold after confidence calculation only when status is not failed.
- [ ] Run `python -m pytest tests/test_fidelity.py -q` and confirm green.

### Task 7: Final verification, review, and commit

**Files:**
- Review all files changed since `68b7710fc3e7d87b4c2214af9a09dce3f583856c`.

**Interfaces:**
- Consumes: the six-ticket spec and repository standards.
- Produces: verified commit on the current branch.

- [ ] Run `python -m pytest -q` from `conversion-service`.
- [ ] Run `python -m compileall -q .` with generated/work directories excluded if needed.
- [ ] Run `./ops/verify-all.ps1 -ContractsOnly` from the repository root.
- [ ] Inspect `git diff --check` and perform separate Standards and Spec reviews locally because subagents are prohibited.
- [ ] Fix any review findings and rerun affected tests plus the final verification commands.
- [ ] Commit all intended files with a focused message and verify the resulting commit/diff.
