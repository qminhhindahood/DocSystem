# Project Remediation Design

**Date:** 2026-07-20

**Goal:** Correct the deployment, authentication routing, ingestion durability, upload validation, prompt-boundary, API-validation, frontend-contract, verification, and repository-hygiene findings identified in the current working copy.

## Scope

This remediation changes the existing production and development paths without introducing a new infrastructure service. PostgreSQL remains the durable source of truth, Redis retains its existing cache and rate-limit responsibilities, and the current Next.js BFF remains responsible for browser session cookies.

The work covers:

- production Compose build contexts, mounts, healthchecks, and Nginx routing;
- durable PDF ingestion with PostgreSQL jobs, leases, recovery, and bounded retries;
- PDF content-signature validation at both public and parser boundaries;
- QA prompt role separation;
- bounded document-list query validation;
- the public-header design contract and its regression tests;
- production deployment verification and Python test dependency declarations;
- removal or repair of obsolete machine-specific repository scripts.

It does not redesign RAG retrieval, document rendering, authentication token semantics, or the frontend visual system beyond the reviewed header regression.

## Architecture

### PostgreSQL-backed ingestion jobs

Add a one-to-one `IngestionJob` record for each uploaded `Document`. A job contains:

- a UUID primary key and unique `documentId` relation;
- `status`: `queued`, `running`, `retrying`, `completed`, or `failed`;
- `attempts` and `maxAttempts`, with a default maximum of five claims;
- `availableAt` for delayed retries;
- nullable `leaseOwner` and `leaseExpiresAt` fields;
- nullable `lastError` and `completedAt` fields;
- `createdAt` and `updatedAt` timestamps;
- indexes supporting due-job scans and expired-lease recovery.

The upload route writes the `Document` and `IngestionJob` in one Prisma transaction. It returns `202` only after both records are durable. Failure to create either record removes the just-written upload file.

A backend `IngestionWorker` starts after infrastructure initialization. Each worker has a process-unique owner identifier. It claims one due job with a PostgreSQL transaction using `FOR UPDATE SKIP LOCKED`, so concurrent backend replicas cannot claim the same available job. A claim:

- selects `queued` or `retrying` jobs whose `availableAt` is due;
- also permits `running` jobs whose lease has expired;
- sets `status=running`, increments `attempts`, and assigns a lease;
- returns the claimed job and document ownership information atomically.

The worker renews the lease while parsing, chunking, and embedding. Lease renewal stops when processing settles. A successful ingestion marks both the document and job complete and then removes the temporary upload. A failed attempt records a sanitized error, clears the lease, and schedules exponential backoff. Once `maxAttempts` is reached, it marks the document and job failed and removes the upload. Process shutdown stops new claims, waits for the active job within a bounded grace period, and leaves any unfinished lease to expire for another worker.

The existing ingestion pipeline will propagate failures to the worker instead of swallowing them. Status updates remain owner-scoped. Indexing must remain idempotent so an expired lease can safely replay a document after a crash.

### Production request routing

All Compose paths are resolved relative to `deploy/docker-compose.prod.yml`:

- application build contexts use `../frontend`, `../backend`, `../docling-service`, `../embeddings-service`, and `../document-renderer`;
- the Nginx build context and certificate mount use `./nginx`;
- healthchecks use executables installed in each image.

Nginx preserves the browser BFF boundary. The following namespaces route to Next.js:

- `/api/session/`;
- `/api/proxy/`;
- `/api/analytics/`.

The remaining `/api/` namespace may continue routing to Express for explicit API clients. The more-specific BFF locations appear before and take precedence over the generic backend location. Streaming proxy settings are retained on the BFF proxy path so document and QA streams are not buffered or prematurely timed out.

### PDF validation

The backend upload route validates all of the following before writing a file or creating database records:

- declared MIME type is `application/pdf`;
- original filename ends with `.pdf` case-insensitively;
- the buffer begins with the PDF signature `%PDF-`;
- size remains within the existing 50 MiB limit.

Docling repeats the signature check after saving the upload and before invoking either parser. A failed signature check returns HTTP 400 and deletes the temporary file. This defense-in-depth boundary protects the parser even if a future internal caller bypasses the public route.

### Prompt boundary

The QA system message contains only stable system rules and the explicitly wrapped untrusted retrieval context. The raw user question appears only in the user-role message. Existing context delimiters, evidence checks, and citation behavior remain unchanged.

### Document-list validation

The document listing route uses one Zod query schema. It:

- trims and bounds `q` to 200 characters;
- accepts `limit` only as a complete base-10 integer from 1 through 100;
- accepts `offset` only as a complete base-10 integer from 0 through 10,000;
- bounds `docType` and `status` strings;
- returns HTTP 400 for malformed input instead of passing partial or unsafe values to Prisma.

### Frontend design contract

The public landing header returns to the approved compact, functionally vibrant header treatment. It uses `surface-vibrant`, the semantic sticky z-index, the established hairline boundary, and a 44–52px height. It removes the custom mix-blend behavior that conflicts with the documented design system.

The design-system test no longer counts global string occurrences. It targets the public header directly and verifies its semantic class, while existing tests continue checking the authenticated header and disallowed legacy decorative APIs.

### Verification and repository hygiene

Add a production Compose contract that supplies non-secret test values and verifies:

- every build context and bind source resolves to an existing path;
- the three BFF API namespaces route to the frontend;
- the generic API namespace routes to the backend;
- service healthchecks use installed executables;
- the renderer remains private and the backend depends on renderer readiness.

The main verification script runs this contract alongside the existing root Compose contract.

Each Python service gains a development requirements file that includes its runtime requirements and `pytest`; production images continue installing runtime requirements only. Documentation identifies the development install command used by the verifier.

Obsolete one-off fix scripts with hard-coded workstation paths are deleted once reference searches confirm they have no consumers. `add_header.py` remains only if it is an intentional utility; its default template directory is resolved relative to the repository or supplied through an argument, never through a workstation-specific absolute path.

## Error Handling and Observability

- Job errors stored in PostgreSQL are truncated and exclude secrets, raw provider responses, and stack traces.
- Logs include job ID, document ID, attempt number, and worker ID.
- Retry delays are deterministic exponential backoff with a bounded maximum, making behavior testable and preventing hot loops.
- Lease-loss detection aborts further state transitions by the old owner.
- Upload validation failures return specific HTTP 400 messages without parser internals.
- Deployment contract failures identify the exact invalid path, route, or executable.

## Testing Strategy

Behavior changes follow test-driven development:

1. Prisma migration integrity and schema-sync tests cover `IngestionJob`.
2. Worker unit tests cover atomic claims, replica exclusion, lease renewal, expired-lease recovery, retry scheduling, terminal failure, success, cleanup timing, and graceful shutdown.
3. Upload route tests reject spoofed MIME-only PDFs and verify transactional job creation.
4. Docling tests reject invalid signatures and prove temporary-file cleanup.
5. QA contract tests prove the question is absent from the system message and present in the user message.
6. Document route tests cover all bounds and malformed integers.
7. Frontend tests target the public header semantic treatment without global occurrence counts.
8. Operations tests cover the production Compose and Nginx contract.
9. Final verification runs backend tests/build/audit, frontend tests/lint/build/audit, Python tests, renderer tests/build where the SDK is available, Compose contracts, operations tests, and `git diff --check`.

## Success Criteria

- Production Compose resolves only existing build contexts and mounts.
- Browser login, session, analytics, and proxied API requests reach Next.js in production.
- Renderer, Docling, and embeddings healthchecks execute available tools.
- An accepted upload survives backend restarts and is retried or completed exactly through durable job state.
- Concurrent replicas do not process the same active lease.
- Non-PDF content is rejected before parser execution.
- User questions never appear in a system-role message.
- Document-list parameters are strictly bounded.
- All frontend design tests pass without an occurrence-count assertion.
- The repository verifier detects regressions in every corrected production contract.
- No workstation-specific absolute path remains in active repository utilities.

## Finding Traceability

| Review finding | Design coverage | Required verification |
|---|---|---|
| Production Compose resolves nonexistent build contexts and mounts | Production request routing | Production Compose contract resolves every build and bind source and asserts each path exists |
| Nginx sends browser BFF namespaces directly to Express | Production request routing | Nginx contract proves session, proxy, and analytics namespaces target Next.js |
| Production healthchecks call executables absent from service images | Production request routing | Compose contract compares each healthcheck command with its Dockerfile-installed tools |
| Ingestion is an in-process fire-and-forget promise | PostgreSQL-backed ingestion jobs | Worker tests cover transactional enqueue, exclusive claim, heartbeat, restart recovery, retry, and terminal failure |
| PDF validation trusts client MIME type and suffix | PDF validation | Backend and Docling tests reject a spoofed non-PDF payload before parsing |
| Public landing header violates the approved design contract and one frontend test fails | Frontend design contract | Targeted landing-header test passes without a global string-occurrence assertion |
| Raw QA question is interpolated into a system-role message | Prompt boundary | QA contract inspects generated messages and proves role separation |
| Document-list query and offset are not strictly bounded | Document-list validation | Route tests cover valid boundaries, partial integers, oversized values, and excessive search text |
| Repository verification ignores the production deployment file | Verification and repository hygiene | Main verifier runs both root and production Compose contracts |
| Python test dependencies and tracked workstation-specific scripts are inconsistent | Verification and repository hygiene | Development dependency imports succeed and repository search finds no active workstation-specific path |
