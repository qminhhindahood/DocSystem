# ori Documentation Structure Review

## Current Structure

The folder is a documentation archive for the AI Document System. It now contains:

- `README.md`: primary narrative entry point and phase index.
- `phases/phase-1-infrastructure.md` through `phases/phase-8-lora.md`: sequential implementation guides.
- `reference/TECHNICAL_SPECIFICATIONS.md`: consolidated configuration reference.
- `reference/best-practices.md`: cross-cutting recommendations.
- `reference/CURRENT_BACKEND_CONTRACT.md`: current Express/TypeScript backend source of truth.
- `reference/SECURITY_BASELINE.md`: mandatory production security baseline.
- `archive/readme-updated.md` and `archive/implementation-guide-updated.md`: historical model-change notes.

No broken local markdown links were found. The folder is readable as a phased plan, but it should be treated as historical source material rather than an exact guide for the current repo.

## Main Issues

1. Backend stack drift

   The docs describe an Express.js + TypeScript backend in the overview, but many implementation snippets are Python/FastAPI files such as `backend/services/orchestrator.py`, `backend/routes/workflow.py`, and `backend/services/rag.py`. The current repo backend is TypeScript/Express, so these snippets can mislead implementation work.

2. Stale model references

   Most files use Qwen3.6. The direct stale references in `README.md` and the stale `phase-4-ollama.md` section heading have been corrected. Remaining `qwen:14b` mentions are historical changelog text in `implementation-guide-updated.md`.

3. Security guidance is weaker than the production requirements

   `TECHNICAL_SPECIFICATIONS.md` has been updated to avoid the literal `airabbit:password` example and to mark authentication as required. The broader guide still needs to document the full required security baseline: JWT auth, required secrets, input validation, upload validation, and virus scanning.

4. Duplicate meta files

   `readme-updated.md` and `implementation-guide-updated.md` are status notes about model replacement. They are useful as changelog evidence, but they should not sit beside the phase guides as if they are current setup documents.

5. API route mismatch

   Frontend examples use paths like `/api/workflow/generate/stream` and upload paths that do not match the current backend contract. Current backend routes are organized around `/api/auth`, `/api/workflow`, `/api/rag`, and `/api/feedback`.

## Recommended Reorganization

The folder now follows this structure:

```text
ori/
  README.md
  STRUCTURE_REVIEW.md
  archive/
  phases/
  reference/
```

## Priority Fixes

1. Finish model-name cleanup:

   - Keep `archive/implementation-guide-updated.md` as changelog text.
   - Verify actual Ollama/Hugging Face model names before copying examples into production docs.

2. Align backend examples to TypeScript:

   - Replace Python/FastAPI backend snippets in phases 3, 4, 5, 7, and `reference/best-practices.md` with TypeScript/Express examples when editing those files deeply.
   - Use `reference/CURRENT_BACKEND_CONTRACT.md` as the current source of truth until all examples are converted.
   - Keep Python only for the actual microservices: Docling, embeddings, and LoRA.

3. Make security mandatory:

   - Keep `reference/SECURITY_BASELINE.md` aligned with production requirements.
   - Mirror key security requirements into `reference/TECHNICAL_SPECIFICATIONS.md`.
   - Remove or clearly label any remaining insecure examples as anti-patterns.

4. Normalize API and document type names:

   - Use `docType` consistently.
   - Use `cong-van` and `thong-bao`, not legacy `cong-hoa` or `ban-ao`.
   - Document current endpoints: `/api/auth/login`, `/api/auth/register`, `/api/workflow/stream`, `/api/rag/index`, `/api/feedback/submit`.

5. Consolidate model-change notes:

   - Keep `archive/readme-updated.md` and `archive/implementation-guide-updated.md` as historical notes, or delete them after merging useful context into `README.md`.

## File-by-File Status

| File | Status | Action |
| --- | --- | --- |
| `README.md` | Good entry point, but stale in spots | Update Qwen command, backend route naming, security status |
| `phase-1-infrastructure.md` | Mostly useful | Add required secrets and current backend env names |
| `phase-2-docling.md` | Useful for Python microservice | Add magic-byte, size, and path-safety guidance |
| `phase-3-rag.md` | Conceptually useful, implementation drift | Convert backend code examples to TypeScript/Prisma |
| `phase-4-ollama.md` | Useful but stale heading and Python backend wrapper | Rename heading, convert wrapper to TypeScript |
| `phase-5-workflow.md` | High drift | Convert FastAPI workflow routes to Express route examples |
| `phase-6-frontend.md` | Useful, but API paths drifted | Update API client paths and auth token handling |
| `phase-7-feedback.md` | Conceptually useful, implementation drift | Align with current feedback route and document ID requirement |
| `phase-8-lora.md` | Useful as ML plan | Verify actual Qwen model names before use |
| `TECHNICAL_SPECIFICATIONS.md` | Valuable reference, security stale | Replace secret examples and mark auth required |
| `best-practices.md` | Useful checklist | Convert Python backend examples or mark as pseudocode |
| `readme-updated.md` | Changelog note | Archive or merge |
| `implementation-guide-updated.md` | Changelog note | Archive or merge |
