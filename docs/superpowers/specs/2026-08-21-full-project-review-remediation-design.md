# Full-Project Review Remediation Design

**Date:** 2026-08-21

**Status:** Approved in conversation

## Purpose

Resolve every actionable finding from the 2026-08-21 full-tree Standards and
Spec review while preserving the standalone product boundary: authenticated
PDF-to-DOCX conversion, owner-scoped jobs, fair quota, honest delivery reports,
and BYOK Gemini support for scanned pages.

The implementation is tracked as ten dependency-ordered tickets under
`.scratch/full-project-review-remediation/issues/`. The primary agent will
implement them directly without delegation.

## Chosen Approach

Introduce a small shared admission and execution context instead of patching
the duplicated single-upload, bulk-upload, queue, and in-process branches one by
one. The context carries the job identity, owner identity, source artifact,
vision configuration, and exact accepted quota charge. Both execution modes use
that context, so ownership, refunds, and cleanup have one contract.

This is intentionally smaller than moving job state into a new database-backed
subsystem. Redis remains the durable queue and job-state store; the in-process
registry remains the development fallback.

## Admission and Execution Lifecycle

Single and bulk endpoints will call one admission operation per uploaded file.
It will:

1. save and validate the PDF;
2. reject locked or unsupported content without charging quota;
3. enforce the BYOK Gemini requirement for scanned pages;
4. atomically accept a quota charge and retain its exact bucket identity;
5. create an owner-scoped job context; and
6. dispatch that same context to Redis or the in-process runner.

Once a source file exists, admission owns it until dispatch succeeds. Every
rejection and unexpected inspection error deletes it. Once dispatched, the
worker or in-process runner owns source cleanup.

Local and Redis-backed job records expose the same owner field. The backend's
existing owner check therefore behaves identically when Redis is unavailable.

## Quota Refund Contract

An accepted charge is represented by the exact quota key used at admission,
not recomputed from the current date. Failed jobs refund that key exactly once;
successful jobs never refund it. Redis uses an atomic once-only refund marker,
and the local fallback maintains equivalent state under its existing lock.

This preserves the product guarantee across UTC midnight and prevents repeated
terminal handling from manufacturing extra quota capacity.

## Conversion Ordering

Pipeline output will be merged by source page number before assembly. Stable
ordering preserves the original order of blocks from the same page. The change
applies after digital and vision extraction, so neither extraction path needs
to know about the other.

## Polling and Rate Limiting

The frontend will use one polling scheduler for the visible job set rather than
one independent timer per row. Status traffic will use a rate-limit policy sized
for the supported ten-job bulk workflow, separate from the stricter general API
limit. Terminal jobs and unmounted views leave the scheduler immediately.

The design retains abuse protection; it does not globally exempt conversion
status traffic without a replacement limit.

## Honest Delivery Reporting

Coverage and generated warnings become stable fields in the report contract.
The frontend presents them in plain Vietnamese alongside confidence, degraded
pages, and flagged blocks. A structurally valid `completed_with_warnings` result
remains downloadable.

## Accessibility

Conversion lifecycle text will use one polite live status region so queued,
processing, completed, warning, and failed changes are announced without
color-only meaning or duplicate announcements. Download and report controls
will meet the documented 44-by-44-pixel minimum on touch layouts while
preserving keyboard focus and visible labels.

## Removed Surfaces

OpenRouter model discovery, credentials, provider options, future-Q&A copy, and
unused dependencies will be removed across backend, frontend, schema, and tests.
Gemini remains the sole owner-scoped encrypted BYOK configuration.

The tracked `ori` master-stack phase archive will be deleted. Repository
contract tests will assert that both the OpenRouter/Q&A surface and master-stack
archive remain absent. Active standalone documentation will not link to either.

## Testing Strategy

Every behavior change follows red-green-refactor:

- admission parity tests cover single/bulk and queue/in-process paths;
- owner tests cover creator access and cross-user denial without Redis;
- quota tests cover queue/local failure, idempotence, and UTC rollover;
- intake tests prove source deletion for each post-save rejection path;
- pipeline tests cover short and alternating mixed-page sequences;
- backend/frontend tests exercise sustained bulk polling without routine 429s;
- report contract and component tests cover coverage, warnings, and downloads;
- accessibility tests cover live status semantics and touch-target classes; and
- repository contracts prove removed surfaces stay removed.

After focused tests pass, the full conversion, backend, frontend, and operations
verification suites must pass before the effort is complete.

## Delivery Order

The shared admission context lands first. Ownership, exact-charge refunds, and
source cleanup follow because they consume that seam. Page ordering, polling,
reporting, accessibility, OpenRouter removal, and archive removal have no
logical blockers and can then be completed as independent testable slices.
