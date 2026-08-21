# Conversion Reliability Repairs Design

## Objective

Repair six verified defects in the standalone PDF-to-DOCX service without
changing its public HTTP schema: table-heavy pages must produce Word tables,
Gemini must see only selected scanned pages, quota rejection must not consume
quota, generated artifacts must expire, unexpected errors must be safe for
users, and low document confidence must produce a warning status.

The review baseline is commit `68b7710fc3e7d87b4c2214af9a09dce3f583856c`.

## Agreed test seams

- `QuotaService.check_and_increment()` and `QuotaService.refund()`.
- `convert_pdf()` observed through its `ConversionReport` and emitted DOCX.
- The Gemini batching contract in `vision.gemini_contract`.
- Job-scoped artifact cleanup through a focused cleanup module.
- `worker.process_job()` and the FastAPI in-process job runner.

## Design

### Atomic quota admission

Redis quota admission will use optimistic locking (`WATCH`, read, `MULTI`,
increment, expiry, `EXEC`). A request at the limit returns `(False, 0)` without
writing. Concurrent retries repeat after `WatchError`. The memory fallback will
perform the same check-and-increment under a lock. Refunds will use the same
atomic pattern and will never create a negative count.

### Table-heavy extraction

`TABLE_HEAVY` will call `page.find_tables()` and pass each result through
`table_quality_gate()`. The gate will measure the extracted grid: at least two
columns and at least 70% non-empty textual cells. Accepted tables will become
`TableBlock`s with headers, rows, page number, confidence, and spans inferred
from PyMuPDF cell geometry. Lines covered by accepted table rectangles will be
excluded from paragraph classification, while surrounding body lines and tables
will be emitted in vertical order. If no detected table passes the gate, the
existing classifier will preserve text, the report will carry a fidelity
warning, and the lifecycle status will be `completed_with_warnings` unless a
stronger failure condition applies.

### Scanned-page isolation

Batch plans will preserve explicit original page lists rather than collapsing
them to ranges. Each request will contain a newly assembled PDF with only those
pages and a prompt mapping batch pages to original page numbers. Result blocks
whose `page` is not in the allowed set will be rejected. Missing allowed pages
will degrade only those pages, preventing mixed digital/scanned duplication.

### Artifact expiration

A focused cleanup module will own exact job paths under `OUTPUT_DIR` and
`MEDIA_DIR`. Completion will touch the DOCX and media directory so their
timestamps represent the retention start. Periodic, idempotent sweeps will
delete artifacts older than `FILE_TTL_S` in both the queue worker and the API
process. The in-process runner will also delete its uploaded source in a
`finally` block. Cleanup failures will be logged and will not crash conversion.

### Safe unexpected failures

Unexpected failures will store one stable Vietnamese message:

> Không thể chuyển đổi tệp này. Vui lòng kiểm tra PDF và thử lại.

Full exceptions remain in logs with `jobId`. Deliberate `IntakeError` and
`VisionAuthError` messages remain unchanged in both worker and in-process modes.
The backend can continue forwarding the service's now-safe `error` field.

### Confidence delivery warning

After confidence is computed, a non-failed conversion below
`DOC_WARN_THRESHOLD` will become `completed_with_warnings` and receive a clear
threshold warning. This cannot override `failed`.

## Verification

Every defect receives a regression test that fails before its implementation.
Focused pytest files run after each vertical slice. Final verification runs the
full conversion pytest suite, Python compile checks, backend tests/build if the
public surface changes, and `ops/verify-all.ps1 -ContractsOnly`. A final local
two-axis review checks standards (`CLAUDE.md`, `CONTEXT.md`, repository
conventions) and this spec independently.

## Non-goals

- No new provider or general OCR subsystem.
- No public API schema change.
- No unrelated frontend work.
- No Redis keyspace notification dependency or cleanup schedule stored only in
  Redis; cleanup must survive Redis loss while the work volume persists.
