# Code Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair every confirmed defect from the 2026-07-15 repository review without changing database schema or generation request contracts.

**Architecture:** Keep the existing service boundaries and fix root causes at their owners: provider resolution in the shared LLM service, lifecycle cleanup in ingestion, request/response contracts in routes, and state ownership in dialog components. Each behavior change receives a regression test that is observed failing before production code changes.

**Tech Stack:** TypeScript, Express, Prisma, Jest, React, Next.js, Radix UI, Vitest, Python/FastAPI, Docker Compose.

## Global Constraints

- Preserve all existing uncommitted changes and do not reset or overwrite unrelated work.
- Do not change the Prisma schema or public generation request contracts.
- Do not log API keys, prompts, generated document text, or raw LLM output.
- Keep Vietnamese UI copy and WCAG 2.1 AA dialog semantics.
- Work inline because repository instructions prohibit subagents and the approved changes already live in the current dirty feature branch.

---

### Task 1: Keyless Local LLM Configurations and Private Logging

**Files:**
- Modify: `backend/src/services/llm_config_service.ts`
- Modify: `backend/src/services/structured_output_service.ts`
- Modify: `backend/src/routes/workflow.ts`
- Test: `backend/src/services/llm_config_service_urls.test.ts`
- Test: `backend/src/services/llm_config_security.test.ts`

**Interfaces:**
- `resolveLLMConfig(record)` must return `apiKey: undefined` when all stored key columns are empty.
- Production logs may include output length and parse context but never raw output or snippets.

- [ ] Add a regression test resolving a saved LM Studio record with empty key columns; expect a usable configuration with no API key.
- [ ] Add source-level or logger-spy assertions proving malformed LLM output is not logged.
- [ ] Run focused Jest tests and confirm they fail for invalid-IV decryption and raw logging.
- [ ] Skip decryption when no encrypted key exists and replace raw-output logs with metadata-only messages.
- [ ] Re-run focused Jest tests and confirm they pass.

### Task 2: Ingestion Cleanup and PDF Size Contract

**Files:**
- Modify: `backend/src/services/ingestion_service.ts`
- Modify: `backend/src/middleware/validation.ts`
- Modify: `docling-service/main.py`
- Test: `backend/src/services/ingestion_service.test.ts`
- Test: `docling-service/tests/test_upload_isolation.py`

**Interfaces:**
- `processIngestion(documentId, access)` must clean stored upload bytes on success and failure while retaining the failed database status.
- Backend and Docling must enforce the same 50 MiB PDF limit.

- [ ] Add a backend regression test that forces parsing failure and expects cleanup after `markFailed`.
- [ ] Extend the Python upload-limit test to accept the shared 50 MiB boundary and reject larger input.
- [ ] Run focused tests and confirm the cleanup test fails against current behavior.
- [ ] Move cleanup into a `finally` path and align Docling’s limit to 50 MiB.
- [ ] Re-run available focused tests; if Python tooling is unavailable, validate Python syntax and report the test gap.

### Task 3: Formatting and Pagination API Correctness

**Files:**
- Modify: `backend/src/routes/workflow.ts`
- Modify: `backend/src/routes/documents.ts`
- Test: `backend/src/routes/workflow.contract.test.ts`
- Test: `backend/src/routes/documents.contract.test.ts`

**Interfaces:**
- `formatter.format(content, docType, { title })` receives the route title.
- Document list responses use one effective limit capped at 100 for query, metadata, and page calculation.

- [ ] Add contract assertions for formatter title options and a requested limit above 100.
- [ ] Run both contract suites and observe the expected failures.
- [ ] Pass `{ title }` and calculate all pagination fields from `effectiveLimit`.
- [ ] Re-run both contract suites and confirm they pass.

### Task 4: Lossless Settings Dialogs and Load Errors

**Files:**
- Modify: `frontend/components/settings/LLMSettingsDialog.tsx`
- Modify: `frontend/components/settings/LLMProviderForm.tsx`
- Modify: `frontend/components/settings/DocumentDefaultsDialog.tsx`
- Modify: `frontend/components/settings/DocumentDefaultsForm.tsx`
- Test: `frontend/test/settings-dialogs.test.tsx`

**Interfaces:**
- Forms remain mounted while discard confirmation is shown.
- Both dialogs consume `onDirtyChange` from their forms.
- Failed initial loads show Vietnamese errors and disable saving until a successful load.

- [ ] Add tests that edit a field, open confirmation, continue editing, and observe the original value.
- [ ] Add a provider-only dirty-state test and initial-load failure tests.
- [ ] Run the dialog suite and observe failures.
- [ ] Render confirmation as an overlay/adjacent state without unmounting forms, wire dirty callbacks, and add explicit load-error state.
- [ ] Re-run the dialog suite and confirm it passes.

### Task 5: Browsable Document Pagination

**Files:**
- Modify: `frontend/app/(app)/documents/page.tsx`
- Test: `frontend/test/documents-page.test.tsx`

**Interfaces:**
- Page state controls `offset = (page - 1) * 20` and resets to page one when filters change.
- Vietnamese previous/next controls expose disabled states and current-page status accessibly.

- [ ] Add tests for moving to page two and resetting pagination after filter changes.
- [ ] Run the focused Vitest file and observe failures.
- [ ] Add page state, query-key integration, navigation controls, and detail-load error handling.
- [ ] Re-run the focused Vitest file and confirm it passes.

### Task 6: Analytics and Proxy Trust Boundary

**Files:**
- Modify: `frontend/app/api/analytics/track/route.ts`
- Modify: `frontend/app/api/proxy/[...path]/route.ts`
- Test: `frontend/test/api-routes.test.ts`

**Interfaces:**
- Analytics requires a session cookie, accepts 1–50 validated events, truncates no data silently, and logs only validated bounded fields.
- The proxy never forwards caller-provided `Forwarded`, `X-Forwarded-For`, or `X-Real-IP` headers.

- [ ] Add route tests for missing session, oversized batches, invalid fields, and stripped forwarding headers.
- [ ] Run focused tests and observe failures.
- [ ] Add bounded validation and block untrusted forwarding headers.
- [ ] Re-run focused tests and confirm they pass.

### Task 7: Deployment and Diff Hygiene

**Files:**
- Modify: `.env.example` or deployment documentation containing required Compose variables.
- Modify: `frontend/app/globals.css`

**Interfaces:**
- Operators can discover `RENDERER_INTERNAL_TOKEN` before running Compose.
- `git diff --check` reports no whitespace errors introduced by the current change set.

- [ ] Locate the canonical root environment example and document generation of a strong renderer token without adding a secret.
- [ ] Remove trailing whitespace and the extra EOF line.
- [ ] Validate Compose with an ephemeral placeholder token and run `git diff --check`.

### Task 8: Complete Verification

**Files:**
- Verify all modified files.

**Interfaces:**
- No source changes after the final verification run.

- [ ] Run backend Jest, build, schema synchronization, and migration integrity tests.
- [ ] Run frontend Vitest, lint, and production build.
- [ ] Run Python AST compilation and Python tests when `pytest` is available.
- [ ] Run .NET tests when an SDK is available.
- [ ] Validate Docker Compose with non-secret ephemeral required values.
- [ ] Reproduce keyless LM Studio resolution against the built backend.
- [ ] Review `git diff` and confirm unrelated user changes remain preserved.
