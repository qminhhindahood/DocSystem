# Project Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved user-only, tenant-isolated RAG assistant with high-fidelity private DOCX templates, frontend account flows, reliable retrieval, and a rehearsed non-destructive Prisma/Docker cutover.

**Architecture:** Work is split into four dependency-ordered phase plans because identity/data safety, document rendering, frontend UX, and runtime/operations are independently reviewable systems. Each phase ends with focused tests and a commit; the final phase runs the integrated acceptance matrix without mutating the live database or restarting the live backend.

**Tech Stack:** Node.js/Express/TypeScript, Prisma/PostgreSQL/pgvector, Redis, Next.js 16/React 19, Vitest/Testing Library, Python/FastAPI, .NET 10 LTS, Open XML SDK 3.5.1, Aspose.Words 26.7.0, Docker Compose.

## Global Constraints

- Preserve all existing user work in the dirty working tree; never reset, checkout, or overwrite unrelated changes.
- Do not restart the live backend, mutate the live PostgreSQL volume, run `prisma migrate reset`, run `docker compose down -v`, or perform the production cutover.
- Restore committed migration history byte-for-byte before adding new staged migrations.
- Keep the deterministic disabled `system-owner` ID `00000000-0000-0000-0000-000000000001` and the `Document.ownerId` import default.
- Every interactive document, template, feedback item, and provider configuration is scoped to its authenticated owner; no user session has cross-user privileges.
- Preserve legacy `Feedback`, `TrainingJob`, `ModelVersion`, `Template.header`, and `Template.signatureBlock` data during this hardening.
- Treat each uploaded DOCX as an immutable rendering shell; never silently fall back to `python-docx`, LibreOffice, or Word COM for authoritative output.
- A template may become `READY` automatically only after structural, semantic, font, license, and rendered-layout checks pass; otherwise use `NEEDS_REVIEW` or `REJECTED`.
- Use one private named Docker volume mounted at `TEMPLATE_STORAGE_DIR`; reject traversal, symlink escapes, hash mismatches, and unauthenticated renderer calls.
- Apply test-driven development: observe the focused regression test fail, implement the minimum behavior, observe it pass, then commit.

## Execution Order

1. [Phase 1: Data Safety and User-Only Security](2026-07-13-hardening-phase-1-data-and-identity.md)
2. [Phase 2: High-Fidelity DOCX Templates](2026-07-13-hardening-phase-2-docx-templates.md)
3. [Phase 3: Frontend Accounts, Templates, and Streaming](2026-07-13-hardening-phase-3-frontend.md)
4. [Phase 4: RAG Reliability, Services, and Cutover Rehearsal](2026-07-13-hardening-phase-4-runtime-and-ops.md)

Phase 2 consumes Phase 1's user JWT and final Prisma `Template` model. Phase 3 consumes the Phase 1 session endpoints and Phase 2 template API. Phase 4 is last because it performs repository-wide verification and disposable infrastructure rehearsals.

## Integrated Acceptance Matrix

- [ ] Backend: `cd backend && npm test -- --runInBand`

Expected: real Jest tests pass; no admin/reviewer/training/model-activation runtime test remains.

- [ ] Backend build/schema: `cd backend && npx prisma validate && npm run check-schema && npm run build`

Expected: schema valid, generated client synchronized, TypeScript build exits 0.

- [ ] Frontend: `cd frontend && npm test -- --run && npm run lint && npm run build`

Expected: Vitest contains real tests and passes; ESLint and Next production build exit 0.

- [ ] Renderer: `dotnet test document-renderer/DocumentRenderer.sln --configuration Release && dotnet build document-renderer/DocumentRenderer.sln --configuration Release --no-restore`

Expected: structural fixtures, floating-shape preservation, fidelity-gate, license/font readiness, and API tests pass.

- [ ] Python: `python -m pytest docling-service/tests embeddings-service/tests -q && python -m compileall -q docling-service embeddings-service`

Expected: unique-upload and liveness/readiness tests pass; compilation exits 0.

- [ ] Compose: `docker compose config --quiet`

Expected: configuration valid; no `lora` or legacy `template-service`; renderer has no public port and shares only the template volume with backend.

- [ ] Disposable migration/import rehearsal: `pwsh -File ops/rehearse-cutover.ps1`

Expected: empty target migrates, legacy-shaped data-only import preserves primary-key sets/counts, owner coverage is 100%, checksums match, and all disposable containers/volumes use rehearsal-specific names.

- [ ] Dependency and hygiene gates: `cd backend && npm audit --audit-level=moderate`; `cd frontend && npm audit --audit-level=moderate`; `git diff --check`

Expected: both audits exit 0 and no whitespace errors are reported.

- [ ] Confirm live-state protection: `git status --short` and `docker compose ps`

Expected: only intentional workspace changes are present; the live backend/database were not restarted or replaced.
