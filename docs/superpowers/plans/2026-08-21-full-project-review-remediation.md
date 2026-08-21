# Full-Project Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The user explicitly requires inline execution by the primary agent; do not dispatch subagents.

**Goal:** Resolve all ten tickets created from the full-tree Standards and Spec review without changing the standalone product boundary.

**Architecture:** A shared admission context becomes the seam used by single and bulk uploads and by queue and in-process execution. Independent slices then fix page ordering, polling, delivery reporting, accessibility, and removed-surface enforcement.

**Tech Stack:** Python 3/FastAPI/PyMuPDF/pytest/fakeredis, TypeScript/Express/Jest/Prisma, React 19/Next.js/Vitest/Tailwind, PowerShell/Pester.

**Spec:** `docs/superpowers/specs/2026-08-21-full-project-review-remediation-design.md`

## Global Constraints

- Implement directly on the current branch; do not use subagents.
- Preserve owner scoping: a job id is never sufficient authorization.
- Invalid, rejected, and failed conversions consume no quota.
- Preserve BYOK Gemini as the only vision provider and never expose its key.
- Keep completed-with-warnings documents downloadable.
- Apply TDD at each behavior seam and run the full suites once at the end.

---

### Task 1: Shared Admission and Rejected-Source Cleanup (Tickets 01 and 04)

**Files:**
- Create: `conversion-service/admission.py`
- Create: `conversion-service/tests/test_admission_lifecycle.py`
- Modify: `conversion-service/main.py`
- Modify: `conversion-service/quota.py`

**Interfaces:**
- Produces: `QuotaCharge(user_id: str, key: str)` and `QuotaService.charge(user_id) -> tuple[QuotaCharge | None, int]`.
- Produces: `AdmittedJob(job_id, pdf_path, filename, user_id, vision, quota_charge)`.
- Produces: `admit_upload(file_obj, filename, user_id, vision, quota, scanned_detector) -> AdmittedJob`.
- Produces: one `_dispatch_job(job: AdmittedJob) -> str` adapter in the API layer.

- [ ] **Step 1: Write failing admission tests**

  Add tests that submit single and bulk uploads through the real FastAPI routes with intake boundaries stubbed. Assert that both modes dispatch an owner-scoped job carrying the accepted quota key. Add post-save password, scanned-page inspection, and unexpected inspection failures and assert the saved source no longer exists and quota remains unchanged.

- [ ] **Step 2: Run tests and verify RED**

  Run: `python -m pytest conversion-service/tests/test_admission_lifecycle.py -q`

  Expected: failures show the duplicated routes omit the shared context and leak at least one post-save rejection source.

- [ ] **Step 3: Implement the shared admission context**

  Add immutable charge/job data objects. Make admission own a saved source until successful dispatch and remove it on every exception. Replace both endpoint loops with the shared operation and one dispatch adapter. Preserve per-file bulk errors and existing HTTP status/detail behavior.

- [ ] **Step 4: Run focused and quota tests**

  Run: `python -m pytest conversion-service/tests/test_admission_lifecycle.py conversion-service/tests/test_quota_refund.py -q`

  Expected: PASS.

- [ ] **Step 5: Commit**

  Run: `git add conversion-service/admission.py conversion-service/main.py conversion-service/quota.py conversion-service/tests/test_admission_lifecycle.py && git commit -m "refactor: unify conversion admission"`

### Task 2: In-Process Owner Parity (Ticket 02)

**Files:**
- Modify: `conversion-service/main.py`
- Modify: `conversion-service/tests/test_job_owner_surface.py`
- Modify: `backend/src/routes/convert.contract.test.ts`

**Interfaces:**
- Consumes: `AdmittedJob.user_id` from Task 1.
- Produces: identical `userId` state in local and Redis-backed status/report payloads.

- [ ] **Step 1: Write a failing local-owner contract test**

  Exercise queue-unavailable submission, inspect the resulting status and report, and assert the creator's id is present. At the backend boundary, assert creator access succeeds and a different authenticated user receives the existing indistinguishable 404.

- [ ] **Step 2: Run tests and verify RED**

  Run: `python -m pytest conversion-service/tests/test_job_owner_surface.py -q`

  Expected: local status or report lacks `userId`.

- [ ] **Step 3: Carry owner identity through local execution**

  Initialize local state from the admitted job and keep owner identity through all lifecycle updates and Redis-to-local fallback.

- [ ] **Step 4: Run focused Python and backend tests**

  Run: `python -m pytest conversion-service/tests/test_job_owner_surface.py -q`

  Run: `npm test -- --runInBand src/routes/convert.contract.test.ts` in `backend/`.

  Expected: PASS.

- [ ] **Step 5: Commit**

  Run: `git add conversion-service/main.py conversion-service/tests/test_job_owner_surface.py backend/src/routes/convert.contract.test.ts && git commit -m "fix: preserve fallback job ownership"`

### Task 3: Exact and Idempotent Failure Refunds (Ticket 03)

**Files:**
- Modify: `conversion-service/quota.py`
- Modify: `conversion-service/main.py`
- Modify: `conversion-service/worker.py`
- Modify: `conversion-service/tests/test_quota_refund_on_failure.py`
- Modify: `conversion-service/tests/test_safe_errors.py`

**Interfaces:**
- Consumes: `QuotaCharge.key` serialized as `quotaKey` in job payload/state.
- Produces: `QuotaService.refund_charge(charge: QuotaCharge | str) -> None`.
- Produces: queue and local once-only refund guards.

- [ ] **Step 1: Write failing rollover and local-failure tests**

  Freeze the quota key at admission, advance the service date, fail the job, and assert only the original key decrements. Repeat terminal handling and assert no second refund. Add the equivalent in-process conversion failure assertion.

- [ ] **Step 2: Run tests and verify RED**

  Run: `python -m pytest conversion-service/tests/test_quota_refund_on_failure.py conversion-service/tests/test_safe_errors.py -q`

  Expected: the current refund recomputes the date and the local runner never refunds.

- [ ] **Step 3: Implement exact-key refunds**

  Serialize the accepted quota key with each job. Refund that key through an atomic once-only marker in Redis and an equivalent local-state flag. Route every failed report and exception branch through the same refund helper; leave successful jobs charged.

- [ ] **Step 4: Run the quota and worker suites**

  Run: `python -m pytest conversion-service/tests/test_quota_refund_on_failure.py conversion-service/tests/test_queue_durability.py conversion-service/tests/test_p3_queue.py conversion-service/tests/test_safe_errors.py -q`

  Expected: PASS.

- [ ] **Step 5: Commit**

  Run: `git add conversion-service/quota.py conversion-service/main.py conversion-service/worker.py conversion-service/tests/test_quota_refund_on_failure.py conversion-service/tests/test_safe_errors.py && git commit -m "fix: refund original quota charges"`

### Task 4: Stable Mixed-Page Assembly (Ticket 05)

**Files:**
- Modify: `conversion-service/assembly/stitcher.py`
- Modify: `conversion-service/tests/test_stitcher.py`
- Modify: `conversion-service/tests/test_vision_wiring.py`

**Interfaces:**
- Produces: `assemble(blocks)` emits ascending page order while preserving input order for equal page numbers.

- [ ] **Step 1: Write failing order tests**

  Add a two-page scanned/digital inversion fixture and an alternating multi-page fixture. Assert literal page sequences and literal same-page text order.

- [ ] **Step 2: Run tests and verify RED**

  Run: `python -m pytest conversion-service/tests/test_stitcher.py conversion-service/tests/test_vision_wiring.py -q`

  Expected: at least the inverted input remains inverted.

- [ ] **Step 3: Add one stable page-order normalization**

  Normalize page order once at the start of assembly. Put page-less synthetic blocks after numbered source blocks and rely on Python's stable sort for same-page order.

- [ ] **Step 4: Run focused conversion tests**

  Run: `python -m pytest conversion-service/tests/test_stitcher.py conversion-service/tests/test_vision_wiring.py conversion-service/tests/test_table_extraction.py -q`

  Expected: PASS.

- [ ] **Step 5: Commit**

  Run: `git add conversion-service/assembly/stitcher.py conversion-service/tests/test_stitcher.py conversion-service/tests/test_vision_wiring.py && git commit -m "fix: preserve mixed document page order"`

### Task 5: Rate-Limit-Safe Polling (Ticket 06)

**Files:**
- Create: `backend/src/middleware/conversion_status_limiter.ts`
- Create: `backend/src/middleware/conversion_status_limiter.test.ts`
- Modify: `backend/src/index.ts`
- Modify: `frontend/app/(app)/convert/page.tsx`
- Create: `frontend/test/convert-polling.test.tsx`

**Interfaces:**
- Produces: a dedicated authenticated conversion-read limiter that replaces the global limiter only for `GET /api/convert/:jobId` and report/result reads.
- Produces: one frontend timer that polls the current non-terminal job set sequentially with no overlapping tick.

- [ ] **Step 1: Write failing backend limiter and frontend scheduler tests**

  Prove that more than 100 supported conversion-status reads are allowed in the general window while unrelated API traffic retains the 100-request ceiling. Render ten submitted jobs with fake timers and assert one scheduler tick polls each active job, terminal jobs leave later ticks, and unmount clears the timer.

- [ ] **Step 2: Run tests and verify RED**

  Run: `npm test -- --runInBand src/middleware/conversion_status_limiter.test.ts` in `backend/`.

  Run: `npm test -- --run frontend/test/convert-polling.test.tsx` in `frontend/`.

  Expected: the global limiter blocks the supported workflow and the UI creates independent timers.

- [ ] **Step 3: Implement scoped limiting and centralized polling**

  Skip only authenticated conversion read paths in the general limiter and mount a separate limiter sized for ten jobs at the chosen polling cadence. Replace the timer map with one interval, one in-flight guard, and a current-jobs ref; stop polling terminal jobs and clear the timer on unmount.

- [ ] **Step 4: Run focused tests and typechecks**

  Run: `npm test -- --runInBand src/middleware/conversion_status_limiter.test.ts src/routes/convert.contract.test.ts && npm run build` in `backend/`.

  Run: `npm test -- --run frontend/test/convert-polling.test.tsx && npm run typecheck` in `frontend/`.

  Expected: PASS.

- [ ] **Step 5: Commit**

  Run: `git add backend/src frontend/app/'(app)'/convert/page.tsx frontend/test/convert-polling.test.tsx && git commit -m "fix: make conversion polling rate-limit safe"`

### Task 6: Coverage and Warning Delivery (Ticket 07)

**Files:**
- Modify: `conversion-service/main.py`
- Modify: `conversion-service/tests/test_p4_hardening.py`
- Modify: `backend/src/services/conversion_service_client.ts`
- Modify: `backend/src/routes/convert.contract.test.ts`
- Modify: `frontend/lib/convert-api.ts`
- Modify: `frontend/app/(app)/convert/page.tsx`
- Create: `frontend/test/convert-report.test.tsx`

**Interfaces:**
- Produces: report field `coverage: number | null` through service, backend, and frontend contracts.
- Consumes: existing `warnings: string[]` and displays every entry.

- [ ] **Step 1: Write failing API and UI tests**

  Assert literal coverage and warning values from conversion-service report JSON through the backend public response. Render a completed-with-warnings job, open its report, and assert Vietnamese coverage text, every warning, and a working download link.

- [ ] **Step 2: Run tests and verify RED**

  Run: `python -m pytest conversion-service/tests/test_p4_hardening.py -q`

  Run: `npm test -- --runInBand src/routes/convert.contract.test.ts` in `backend/`.

  Run: `npm test -- --run frontend/test/convert-report.test.tsx` in `frontend/`.

  Expected: coverage is absent and warnings are not rendered.

- [ ] **Step 3: Wire the stable report contract and UI**

  Add nullable coverage to all types and report responses. Show coverage as a percentage and warnings as a clearly labelled Vietnamese list without disabling result links.

- [ ] **Step 4: Run focused tests and typechecks**

  Run the three focused commands from Step 2, then `npm run build` in `backend/` and `npm run typecheck` in `frontend/`.

  Expected: PASS.

- [ ] **Step 5: Commit**

  Run: `git add conversion-service/main.py conversion-service/tests/test_p4_hardening.py backend/src frontend/lib/convert-api.ts frontend/app/'(app)'/convert/page.tsx frontend/test/convert-report.test.tsx && git commit -m "feat: surface conversion coverage and warnings"`

### Task 7: Accessible Conversion Feedback (Ticket 08)

**Files:**
- Modify: `frontend/app/(app)/convert/page.tsx`
- Modify: `frontend/test/convert-report.test.tsx`
- Modify: `frontend/test/design-system.test.ts`

**Interfaces:**
- Produces: one polite live region for status labels and 44-pixel minimum primary result controls.

- [ ] **Step 1: Write failing semantic and touch-target tests**

  Render queued and terminal jobs and assert the status text is exposed through `role="status"` with polite live behavior. Assert both download links and the report toggle use the existing 44-pixel minimum-height token/class.

- [ ] **Step 2: Run tests and verify RED**

  Run: `npm test -- --run frontend/test/convert-report.test.tsx frontend/test/design-system.test.ts` in `frontend/`.

  Expected: status has no live semantics and result controls are shorter than 44 pixels.

- [ ] **Step 3: Implement accessible semantics and sizing**

  Add one non-duplicative live status element per job and update the three result controls to the documented touch target while keeping keyboard focus and visible copy.

- [ ] **Step 4: Run tests, lint, and typecheck**

  Run: `npm test -- --run frontend/test/convert-report.test.tsx frontend/test/design-system.test.ts && npm run lint && npm run typecheck` in `frontend/`.

  Expected: PASS.

- [ ] **Step 5: Commit**

  Run: `git add frontend/app/'(app)'/convert/page.tsx frontend/test/convert-report.test.tsx frontend/test/design-system.test.ts && git commit -m "fix: make conversion feedback accessible"`

### Task 8: Remove OpenRouter and Future Q&A (Ticket 09)

**Files:**
- Delete: `backend/src/config/openrouter_models.ts`
- Delete: `backend/src/services/openrouter_models.ts`
- Delete: `backend/src/services/openrouter_models.test.ts`
- Delete: `frontend/components/settings/OpenRouterModelPicker.tsx`
- Modify: `backend/src/constants/llm-providers.ts`
- Modify: `backend/src/routes/llm-settings.ts`
- Modify: `backend/src/routes/llm-settings.contract.test.ts`
- Modify: `backend/src/services/llm_config_service.ts`
- Modify: `backend/src/services/llm_config_security.test.ts`
- Modify: `backend/prisma/schema.prisma`
- Modify: `frontend/lib/llm-providers.ts`
- Modify: `frontend/lib/settings-api.ts`
- Modify: `frontend/components/settings/LLMProviderForm.tsx`
- Modify: `frontend/components/settings/LLMSettingsDialog.tsx`
- Modify: `frontend/test/settings-dialogs.test.tsx`
- Modify: `frontend/test/proxy-policy.test.ts`
- Modify: `backend/src/routes/removed_surfaces.contract.test.ts`
- Modify: `frontend/test/removed-surfaces.test.ts`

**Interfaces:**
- Produces: Gemini-only provider validation and settings UX.
- Preserves: encrypted per-user key storage and `getVisionConfig()` output for conversion jobs.

- [ ] **Step 1: Replace OpenRouter tests with failing Gemini-only contracts**

  Assert OpenRouter settings and catalog requests are rejected or absent, Gemini remains save/test/delete capable, and removed-surface contract checks cover provider code and UI artifacts.

- [ ] **Step 2: Run tests and verify RED**

  Run: `npm test -- --runInBand src/routes/llm-settings.contract.test.ts src/services/llm_config_security.test.ts src/routes/removed_surfaces.contract.test.ts` in `backend/`.

  Run: `npm test -- --run frontend/test/settings-dialogs.test.tsx frontend/test/proxy-policy.test.ts frontend/test/removed-surfaces.test.ts` in `frontend/`.

  Expected: OpenRouter remains accepted and visible.

- [ ] **Step 3: Remove the surface and simplify provider contracts**

  Delete catalog code and picker UI, restrict validation/types/presets to Gemini, remove future-Q&A copy, update the schema comments, and preserve encrypted generic key columns because Gemini still needs them.

- [ ] **Step 4: Run package verification**

  Run: `npm test -- --runInBand src/routes/llm-settings.contract.test.ts src/services/llm_config_security.test.ts src/routes/removed_surfaces.contract.test.ts && npm run build && npx prisma validate && npm run check-schema` in `backend/`.

  Run: `npm test -- --run frontend/test/settings-dialogs.test.tsx frontend/test/proxy-policy.test.ts frontend/test/removed-surfaces.test.ts && npm run lint && npm run typecheck` in `frontend/`.

  Expected: PASS.

- [ ] **Step 5: Commit**

  Run: `git add -A backend frontend && git commit -m "refactor: remove OpenRouter Q&A surface"`

### Task 9: Remove Master-Stack Archive (Ticket 10)

**Files:**
- Delete: `ori/`
- Modify: `ops/tests/RepositoryHygiene.Tests.ps1`

**Interfaces:**
- Produces: an operations contract that fails when the tracked archive directory exists.

- [ ] **Step 1: Write the failing absence contract**

  Add `ori` to the repository hygiene test's removed-surface list and run the real Pester suite against the current working tree.

- [ ] **Step 2: Run the contract and verify RED**

  Run: `pwsh -NoProfile -File ops/verify-all.ps1 -ContractsOnly`

  Expected: the new hygiene assertion fails because `ori/` exists.

- [ ] **Step 3: Remove the archive and stale links**

  Delete the sixteen tracked archive files and leave Git history as the quarantine. The pre-task reference scan found no active standalone links to update.

- [ ] **Step 4: Run operations contracts**

  Run: `pwsh -NoProfile -File ops/verify-all.ps1 -ContractsOnly`

  Expected: compose checks, all Pester tests, and whitespace integrity pass.

- [ ] **Step 5: Commit**

  Run: `git add -A ori ops docs README.md CLAUDE.md CONTEXT.md PRODUCT.md && git commit -m "chore: remove master stack archive"`

### Task 10: Full Verification and Review

**Files:**
- Modify only files needed to correct verification or review findings within this spec.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a clean, committed branch whose diff satisfies the approved specification.

- [ ] **Step 1: Run full conversion verification**

  Run: `python -m pytest -q` in `conversion-service/`.

  Expected: all tests pass.

- [ ] **Step 2: Run full backend verification**

  Run: `npm test -- --runInBand && npm run build && npx prisma validate && npm run check-schema` in `backend/`.

  Expected: all tests and contract checks pass.

- [ ] **Step 3: Run full frontend verification**

  Run: `npm test -- --run && npm run lint && npm run build` in `frontend/`.

  Expected: all tests, lint, typecheck, and production build pass.

- [ ] **Step 4: Run full operations verification**

  Run: `pwsh -NoProfile -File ops/verify-all.ps1`

  Expected: every enabled operations gate passes.

- [ ] **Step 5: Review the complete implementation**

  Invoke `$code-review` against commit `a655d6b` and fix every valid Standards or Spec finding introduced by this effort. Re-run affected focused tests after each correction.

- [ ] **Step 6: Commit final corrections and confirm cleanliness**

  Run: `git diff --check && git status --short && git log -10 --oneline`

  Expected: no whitespace errors, no uncommitted changes, and implementation commits present on the current branch.
