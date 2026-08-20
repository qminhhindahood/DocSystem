# Spec: Standalone conversion product — prune, harden, gate

Status: ready-for-agent

## Problem Statement

I forked the master DocAI stack into a standalone PDF→DOCX conversion product, but the fork still carries the master's full surface: RAG, document generation, QA, templates, feedback/LoRA routes and pages, nine unused database models, CI jobs that test services this product doesn't run, and a production pipeline that deploys the wrong images. Meanwhile the product's actual core — the conversion service — runs through no CI gate at all, a crashed worker silently loses jobs, a failed conversion still consumes my daily quota, and any logged-in user can read any other user's conversion job if they know its id. The documentation describes a different product entirely. The result is a repo where the honest, well-built conversion engine is buried under a master stack's worth of dead weight, and where the guarantees the product claims (owner scope, quota fairness, durability) are not actually enforced.

## Solution

Cut the repo down to the pure conversion product — auth, convert, quota, download — and harden what remains: the conversion service gets a CI gate (tests + scanned container build), the queue becomes crash-safe with reclaim on startup, quota is refunded when a conversion fails, job reads are owner-scoped, the database schema is squashed to the two auth models on plain Postgres, the frontend is pruned to the convert surface and gains a compose service so one command runs the whole product, the master-stack directories and their CI/ops/deploy machinery are deleted, and the documentation is rewritten to describe the product that actually exists.

## User Stories

1. As a user, I want to upload a PDF and receive a Decree 30/2020-compliant DOCX, so that I don't reformat administrative documents by hand.
2. As a user, I want my conversion to survive a worker crash, so that I never watch a spinner for 24 hours on a job that silently died.
3. As a user, I want a failed conversion to not consume my daily quota, so that infrastructure failures don't cost me documents.
4. As a user, I want invalid uploads to remain free of quota charge, so that garbage files never count against my cap.
5. As a user, I want to poll my job's status and download my result, so that I can track progress and retrieve my file.
6. As a user, I want a confidence-flag review report for my conversion, so that I can spot-check low-confidence blocks and pages before using the document.
7. As a user, I want to convert up to ten PDFs in one bulk submission, so that I can process a batch without ten round trips.
8. As a user, I want my job's status, report, and result to be visible only to me, so that my government documents stay private even if another user learns my job id.
9. As a user, I want the backend health endpoint to reflect only services this product actually uses, so that "healthy" means healthy instead of permanently degraded.
10. As a user, I want to run the entire product — database, queue, conversion, worker, backend, frontend — with one compose command, so that there is no gap between "works in dev" and "runs as a product".
11. As a user, I want documentation that describes this product, so that I (and any agent or colleague) am never handed a map of the wrong territory.
12. As a developer, I want the conversion service's tests and container image to run in CI with vulnerability scanning, so that the core of the product is never shipped untested or unscanned.
13. As a developer, I want deleted master-stack surfaces to be asserted absent by contract tests, so that no future change silently re-introduces them.
14. As a developer, I want the database schema to contain only the models the product uses, so that fresh boots don't create nine dead tables and a vector index nobody queries.
15. As a developer, I want the ops verification suite to verify only what this repo contains, so that a green run means the standalone stack is sound.
16. As a developer, I want the queue worker to reclaim jobs left in-flight by a previous crashed worker on startup, so that restarts are self-healing.
17. As a developer, I want the job store to expose its Redis client through a public property, so that no module reaches through a private attribute.
18. As a developer, I want the migration history squashed to a single init migration, so that fresh deploys apply one migration instead of sixteen, and the schema matches the pruned product.
19. As a developer, I want the production deploy workflow deleted rather than left deploying master-stack images, so that no pipeline exists that could push the wrong product.
20. As a developer, I want the frontend pruned to the convert, auth, and landing surfaces, so that there are no doors to empty rooms.

## Implementation Decisions

- **Product identity**: this repo is the pure conversion product. Auth + convert + quota + download is the entire surface. Everything inherited from the master stack is cut; git history is the only quarantine.
- **Backend prune**: unmount and delete the QA, RAG, workflow, templates, feedback, LLM-settings, documents, and document-profile routes and the services they depend on. Delete the ingestion and template-compilation workers and their boot wiring. Strip the docling, embeddings, and renderer probes from the readiness service so health reflects only Postgres, Redis, and the conversion service. Clean the API root listing, the per-endpoint rate limiters, and the long-running-path set to reference only surviving endpoints. Keep auth, convert, and all cross-cutting middleware.
- **Schema squash**: replace the sixteen-migration history with a single clean init migration creating only the User and PasswordResetToken models. Swap the Postgres image from the pgvector variant to plain postgres:15-alpine and drop the vector extension from the init script. Delete the pgvector check and the HNSW/Chunk index boot wiring. The compose migrate service and the prepare-database baseline step simplify accordingly. Recorded as ADR-0001.
- **IDOR fix**: the convert route's status, report, and result reads validate that the job's owning user matches the authenticated user before returning anything. Unknown-job and not-your-job are indistinguishable to the caller (both 404) so job ids are never confirmed to strangers.
- **Worker durability**: dequeue becomes an atomic pop-and-push into a processing list; the worker clears the processing entry when a job reaches a terminal state; on startup the worker reclaims anything left in the processing list (re-queued, since a crashed worker cannot have finished it). No heartbeat/lease in this round — crash recovery is the scoped failure mode.
- **JobStore interface**: the Redis client is exposed through a public read-only property; every existing reach-through into the private attribute (quota construction, metrics aggregation, worker metric recording) moves onto the property.
- **Quota refund**: the quota service gains a refund operation; the worker refunds the submitting user's quota when a conversion ends failed. Refund is idempotent per job (a job refunds at most once) and never drives the counter below zero.
- **CI gate**: a new CI job runs the conversion service's pytest suite. The containers matrix gains a conversion-service entry built from its Dockerfile and scanned with the same pinned Trivy action and severity policy as the other images. No deploy-workflow entry.
- **Frontend prune**: delete the dashboard, documents, generate, QA, and templates pages with their components and API clients. Keep the convert page (self-contained), auth pages, and landing. Navigation already lists only convert.
- **Frontend compose service**: the frontend gains a compose service built from a standalone Next.js production build, proxying to the backend, so one compose command runs the whole product.
- **Master sweep**: delete the docling service, embeddings service, document renderer, cloudflare worker, terraform infra, deploy directory, DOCX template files, master-stack docs folder, and the header-processing utility. Delete their CI jobs (renderer, python matrix, terraform, and the docling/embeddings/renderer container entries). Delete the production deploy workflow outright.
- **Ops rewrite**: the verification suite shrinks to compose config validation, the standalone compose contract test, the Pester operations tests, and git whitespace integrity. The master-specific suites (Neon migration preflight, production compose test, the torch-requiring Python step) are deleted. The repository-contracts CI job keeps running the slim suite.
- **Docs rewrite**: CLAUDE.md is rewritten for the standalone product (architecture, quick start, ports, testing, gotchas — all matching reality). PRODUCT.md is rewritten as the conversion product's register in the same effort.

## Testing Decisions

- **Good tests here test external behaviour only**: HTTP status codes and response shapes at mounted routes, observable JobStore semantics against a fake Redis client, and filesystem/source-scan assertions for deletions. No tests assert on private internals; the one current exception (tests reaching into quota's private memory dict) is tolerated as prior art but not extended.
- **Seam 1 — HTTP contract**: the IDOR fix, quota refund, and route pruning are tested by fetching against the mounted Express app (prior art: the convert contract tests) and via FastAPI TestClient (prior art: the quota refund tests). Pruned routes are asserted to return 404.
- **Seam 2 — Redis queue boundary**: BRPOPLPUSH semantics, startup reclaim, the public redis_client property, and refund-on-failure are tested against a fake Redis client. `fakeredis` is added to the conversion service's dev dependencies; prior art is the queue tests, which currently exercise only the in-memory fallback.
- **Seam 3 — filesystem as contract**: the existing removed-surfaces contract test pattern is extended to assert the deleted routes, services, workers, Prisma models (schema source scan), master-stack directories, and CI job entries stay absent.
- **Seam 4 — compose config contract**: the frontend service, postgres image swap, and init-script change are covered by compose config validation plus the standalone compose contract test, run by the slim ops suite.
- **CI gate verification**: the new pytest job and containers entry are verified by running in CI; locally they mirror the README's pytest invocation and the existing matrix rows.

## Out of Scope

- Heartbeat/lease TTL for wedged (not crashed) jobs — noted as a cheap future addition if jobs ever wedge.
- Redis Streams or BullMQ migration — the single-worker list queue is sufficient.
- Any production deployment target for the standalone stack — the deploy workflow is deleted, not rewritten.
- The `KEYS`-based metrics aggregation in the metrics endpoint — fine at current scale, flagged as a landmine only.
- Quarantining instead of deleting anything — git history is the quarantine.
- Changes to the conversion pipeline itself (triage, structuring, rule engine, rendering) — it is the good part and stays untouched.
- The quota counter-leak edge case (Redis dying between INCR and EXPIRE) — accepted.

## Further Notes

- Blocking edges for tickets: schema squash is blocked by the backend prune (models can't drop while services reference them); the frontend compose service is blocked by the frontend prune; the docs rewrite is blocked by everything (it describes the final state); the master sweep lands after the prunes so contracts match reality. The CI gate, worker durability, and IDOR fix are independent and can ship first.
- ADR-0001 records the migration-history squash decision.
- The glossary in CONTEXT.md is the vocabulary of record; note that "triage" in this project means page triage inside the conversion pipeline, distinct from the issue-tracker triage roles.
