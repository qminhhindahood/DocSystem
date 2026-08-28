# Comprehensive Review Remediation Design

**Date:** 2026-08-28

**Status:** Approved in conversation

## Purpose

Resolve every actionable finding from the 2026-08-24 repository-wide review
without discarding existing database volumes, conversion artifacts, or the
user's current uncommitted work. The result must remain the same standalone
product: authenticated PDF-to-DOCX conversion with owner-scoped jobs, honest
confidence reporting, Decree-30 typography, fair quota, and BYOK Gemini for
scanned pages.

## Chosen Approach

Use staged, compatibility-preserving repairs instead of a broad rewrite. The
implementation starts with the two release blockers, then repairs durable
service behavior, conversion fidelity, API contracts, frontend lifecycle, and
CI enforcement. Every behavior change gets a failing regression test before
production code changes, and every deployment change gets a repository or
container contract test before configuration changes.

The existing Redis queue, Prisma database, FastAPI conversion service, Express
backend, and Next.js frontend remain the system boundaries. New code is limited
to focused helpers where the current boundary cannot express the required
behavior safely.

## Container and Deployment Safety

The conversion image will use a root `.dockerignore` that excludes runtime work
directories, virtual environments, caches, test outputs, local environment
files, and repository metadata. The Dockerfile will copy only the Python source,
runtime requirements, and shared typography data required at runtime. A
container contract test will fail if `/app/work` contains build-time files or
if `/app/.venv` is present.

The frontend Compose service will receive `PASSWORD_RESET_MODE`,
`TURNSTILE_SITE_KEY`, and `FRONTEND_TRUST_PROXY_HOPS` through explicit mappings.
Frontend readiness will validate production auth configuration, while liveness
will remain a process-only signal. Missing required configuration must prevent
the service from being considered ready instead of producing a streamed error
from `/login`.

No existing local image or volume is deleted automatically. After the fixed
image is verified, operators will be told to rebuild before publishing and to
treat older conversion images as potentially sensitive.

## Existing-Volume Migration Compatibility

Fresh databases continue to run `prisma migrate deploy` normally. Before that
command, a read-only baseline detector will inspect databases that have product
tables but no Prisma migration history. It may request `prisma migrate resolve
--applied 20260901000000_init_standalone_auth` only when all required current
tables and columns are present. A mismatch fails closed with a backup-safe,
actionable message; it never drops, truncates, or rewrites user tables.

The detector and Compose command will be covered by tests for a fresh database,
a compatible pre-baseline database, an already migrated database, and an
incompatible schema. The documented fresh-only assumption in ADR-0001 will be
amended to describe this compatibility path.

## Upload Admission and Transport

FastAPI endpoints will move synchronous validation, copying, password checks,
and page triage to worker threads with `asyncio.to_thread`. Bulk admission will
remain ordered and bounded while yielding the event loop between files.

The backend conversion client will stream files from disk into multipart
requests rather than materializing Buffers and Blobs. Bulk requests will also
enforce an aggregate byte limit so the accepted contract has a predictable
memory and transport bound. Single and bulk route cleanup ownership remains
unchanged: the backend deletes staging files after the conversion service has
accepted or rejected the request.

Multer MIME and size failures will be normalized at the route boundary. Invalid
types return HTTP 400, files over 50 MB return HTTP 413, and unexpected errors
retain the generic HTTP 500 response. Partial staging files are removed.

## Redis Failure Semantics

Queue workers will use strict Redis semantics rather than the API's development
memory fallback. A Redis failure during load, save, dequeue, or terminal cleanup
raises a dedicated availability error. The worker exits so Compose restarts it,
leaves the source file and processing-list entry intact, and reclaims that job
after Redis recovers.

The API may retain its in-process development fallback, but a store that was
previously Redis-backed will attempt a bounded reconnect before changing mode.
No disconnected loop may poll without delay, and no worker may report a
successful terminal state only in process memory.

## Conversion Fidelity

Zone extraction becomes lossless. Page-one header lines are consumed only when
an administrative header is recognized; top-zone lines on later pages and
unrecognized bottom-zone lines return to ordinary body classification. Table
pages follow the same rule without duplicating text already represented by an
accepted table.

Running-header removal requires both repeated normalized text and geometry in a
narrow top or bottom page band. Repeated body paragraphs remain intact. Split
tables merge only when pages are consecutive, column counts match, normalized
headers match or the continuation omits a header, and table boundary evidence
indicates continuation. Independent same-width tables retain their own headers.

Regression fixtures will cover page-two top content, unrecognized bottom
content, true running headers, repeated body clauses, valid table continuation,
and independent consecutive tables.

## Frontend Security and Lifecycle

Trusted proxy selection will follow the direct-peer model: configured trusted
proxies are removed from the right edge of the forwarding chain and the first
untrusted address is used. Tests will include a clean one-proxy request and a
client-supplied forwarding value that the trusted proxy appends to.

All conversion-job mutations will update React state and `jobsRef` through one
helper. Report toggles therefore survive concurrent polling. PDF preview URLs
will be created lazily, mounted only for the expanded preview, and revoked when
that preview closes or its job leaves the visible set. The page will not mount
an iframe for every completed job.

The theme icon target will be at least 44 by 44 pixels. Authentication and root
metadata copy will describe only PDF-to-DOCX conversion, confidence review, and
Decree-30 output. `PRODUCT.md` will be migrated from the deprecated register
shape to the current product-context headings without changing the product
boundary.

## Typography, Dependencies, and CI

The typography sync guard will validate the canonical JSON and the remaining
Python consumer; references to the deleted TypeScript generation consumer will
be removed. The guard and release preflight will run in CI.

Production dependency audits remain mandatory. Development lockfiles will be
updated until full npm audits have no known high-severity findings, and CI will
audit development dependencies as a separate gate. The Python test-client
dependency will move to the supported HTTPX compatibility path so the suite is
warning-free. Dependency updates must not introduce a production package solely
to silence an audit.

## Testing and Verification

Each slice follows red-green-refactor with focused tests before implementation.
Final verification requires:

- all backend, frontend, conversion, and operations tests;
- backend and frontend production builds, frontend lint, Python compile, and
  Prisma schema validation;
- typography preflight and the P0a document-rendering gate;
- full production and development npm audits plus a Python advisory scan;
- conversion, backend, and frontend container builds followed by image-content
  inspection proving that no work PDFs or virtual environment were copied;
- a fresh-volume Compose boot and a compatible existing-volume boot;
- live health, readiness, login, signup-configuration, upload rejection, queued
  digital PDF conversion, polling, report, and result-download smoke tests; and
- desktop and mobile accessibility checks for the changed frontend controls.

Real Gemini OCR and production SMTP delivery remain credential-dependent manual
gates. Their existing mocked contracts must stay green, but this remediation
does not invent or store external credentials.

## Delivery Order

1. Container context safety and frontend production configuration.
2. Existing-volume migration baseline.
3. Non-blocking admission, streaming transport, and Multer error contracts.
4. Strict Redis worker recovery.
5. Lossless zones, running-header detection, and table continuation.
6. Proxy security and frontend state/preview lifecycle.
7. Product copy, touch targets, typography guard, and dependency maintenance.
8. Full static, automated, container, runtime, and accessibility verification.

## Non-Goals

- Replacing Redis or Prisma with a new persistence subsystem.
- Deleting or recreating existing project volumes.
- Reintroducing generation, RAG, chat, template, or admin surfaces.
- Adding server-owned vision credentials.
- Redesigning the visual language beyond the reviewed copy and target-size fixes.
