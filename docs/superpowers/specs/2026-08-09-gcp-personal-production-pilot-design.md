# Google Cloud Personal Production Pilot Design

**Date:** 2026-08-09

**Status:** Approved for implementation

## Goal

Deploy DocAI as a secure, publicly reachable personal production pilot on Google Cloud before the user's $300 trial credit expires on October 1, 2026. The pilot is designed for one operator, fewer than 20 invited users, one or two simultaneous document jobs, and low overall traffic. It must preserve a clear path to a small beta without paying for high availability prematurely.

This is a production pilot rather than an SLA-backed service. Cold starts, single-region maintenance, and brief recovery windows are acceptable. Silent data loss, public internal services, plaintext secrets, unverified deployments, and unbounded spending are not acceptable.

## Fixed Decisions

- The production source repository is a new private GitHub repository named `DocAI`. The existing GitLab repository remains an archive and is not overwritten. The current development history is reconciled with `master`, verified, and pushed to GitHub before production infrastructure is deployed.
- Google Cloud project resources use `asia-southeast1` (Singapore) unless a required product is unavailable there. Keeping compute, database, storage, and registry in one region reduces latency from Thailand and avoids cross-region transfer.
- Cloud Run hosts the frontend, backend, Docling, Jina embeddings proxy, and document renderer.
- Only the frontend is unauthenticated and public. Every other Cloud Run service requires Google-signed service identity.
- The backend keeps exactly one warm instance with CPU allocated for the complete instance lifecycle because the current ingestion and template-compilation workers poll continuously.
- Frontend and processing services scale to zero. Expensive processing services use concurrency `1` and maximum instances `1` during the personal phase.
- Cloud SQL for PostgreSQL stores application data and pgvector embeddings. The initial database is a single-zone `db-g1-small` PostgreSQL 15 instance with 10 GiB SSD storage, automatic storage growth disabled, daily automated backups, and point-in-time recovery enabled.
- Upstash Free supplies Redis through a TLS `rediss://` connection. It is not treated as durable application storage.
- Regional Cloud Storage buckets replace Docker volumes for templates, uploads, and RAG operational artifacts.
- Secret Manager supplies runtime credentials. No service-account JSON key, `.env.prod`, database URL, API key, or bootstrap password is committed or stored in GitHub secrets when Workload Identity Federation or Secret Manager can be used instead.
- GitHub Actions builds immutable images, runs verification, applies database migrations through a one-shot Cloud Run Job, deploys revisions, performs smoke checks, and promotes traffic.
- Public registration remains disabled. The first operator account is created by an audited one-shot bootstrap job.
- The default `run.app` hostname is used for the first launch. A custom domain is a later operational change after the deployment is stable.
- User LLM keys remain per-user and encrypted by the backend. Google Cloud trial credit is not assumed to pay for Gemini API, Jina API, SMTP, or domain-registration costs.

## Architecture

### Public Request Path

The browser connects only to the public `docai-frontend` Cloud Run service over Google-managed HTTPS. Next.js continues to act as the backend-for-frontend: login, session, and `/api/proxy/*` requests terminate at the frontend and are forwarded server-side to `docai-backend`.

The frontend service identity receives `roles/run.invoker` only on the backend service. The proxy obtains a Google-signed ID token whose audience is the backend Cloud Run URL and sends it as `X-Serverless-Authorization`. The user's DocAI session token remains in its existing cookie and continues through the application authorization layer. Platform identity and application identity remain separate.

The backend has no unauthenticated ingress. It invokes Docling, the embeddings proxy, and the renderer with its own service identity and a service-specific ID token. The existing renderer token stays as defense in depth, but IAM is the primary network authorization boundary.

Google documents ID-token-based private service calls and states that same-region Cloud Run service-to-service traffic has no networking charge: <https://cloud.google.com/run/docs/authenticating/service-to-service>.

### Cloud Run Services

| Service | Exposure | CPU / memory | Min / max | Concurrency | Purpose |
|---|---|---:|---:|---:|---|
| `docai-frontend` | Public | 1 vCPU / 512 MiB | 0 / 2 | 40 | Next.js UI, sessions, and BFF proxy |
| `docai-backend` | Private | 1 vCPU / 2 GiB | 1 / 1 | 20 | Express API and both polling workers |
| `docai-docling` | Private | 2 vCPU / 4 GiB | 0 / 1 | 1 | PDF/DOCX extraction and OCR |
| `docai-embeddings` | Private | 1 vCPU / 256 MiB | 0 / 1 | 10 | Authenticated Jina Cloud proxy |
| `docai-renderer` | Private | 1 vCPU / 3 GiB | 0 / 1 | 1 | LibreOffice rendering and preview generation |

All services use second-generation execution, startup and liveness probes, a request timeout matched to the workload, maximum-instance limits, and the existing non-root container users. The backend uses instance-based CPU allocation so workers continue outside active HTTP requests. The frontend and processing services use request-based billing.

The backend maximum remains `1` because its workers run in-process. This is an explicit personal-phase limitation, not an accidental scaling configuration. The small-beta phase separates workers or replaces polling with Cloud Tasks and jobs before increasing API replicas.

### Database and Migrations

Cloud SQL runs PostgreSQL 15 with the `vector` extension. Cloud Run connects through the managed Cloud SQL integration and a bounded Prisma connection pool. With a backend maximum of one instance, the initial pool maximum is `10`; the migration and bootstrap jobs each use a separate short-lived pool.

Application instances do not run migrations on startup. The current production image command is split so the normal backend starts only the application. A separate `docai-migrate` Cloud Run Job runs the pgvector preflight, `prisma migrate deploy`, schema-integrity checks, and ownership-integrity assertion before a new backend revision receives traffic. A migration failure stops the deployment.

Migrations remain forward-only. Every destructive schema change requires a preceding backup and a documented expand/migrate/contract sequence. Application rollback may move traffic to an earlier compatible revision; database rollback uses restore to a new instance rather than editing Prisma migration history.

Google documents Cloud Run's Cloud SQL integration and its per-instance connection limits: <https://cloud.google.com/sql/docs/postgres/connect-run>.

### Persistent Files

Three regional buckets provide persistent file storage:

- `docai-templates-${project_id}`: backend read/write; renderer read-only.
- `docai-uploads-${project_id}`: backend read/write.
- `docai-rag-state-${project_id}`: backend read/write for manifests and evaluation reports.

Here `${project_id}` is the required Terraform project-ID input, not a literal suffix.

The buckets are mounted through Cloud Run Cloud Storage volume mounts at the paths the application already uses: `/data/templates`, `/data/uploads`, and `/data/rag-state`. Mounts specify the existing container UID/GID and use least-privilege bucket IAM. Object versioning is enabled for templates and uploads, with noncurrent versions deleted after 30 days. Temporary extraction and rendering files remain under service-local `/tmp` and disappear with the instance.

Cloud Storage FUSE is not fully POSIX compliant and does not lock concurrent writers. The personal pilot avoids conflicting writes through unique user/document paths, immutable template versions, backend maximum instances `1`, and processing concurrency `1`. A later multi-instance phase replaces shared mutation with the Cloud Storage client API and generation-match preconditions before lifting these limits.

Google documents Cloud Run volume mounts, their memory cost, and their concurrency limitations: <https://cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts>.

### Redis

Upstash Free is configured with TLS and a region close to Singapore. Redis remains a cache, rate-limit coordinator, and transient state store; PostgreSQL remains authoritative. The readiness endpoint reports Redis unavailable rather than silently calling a process-local fallback healthy in production.

The pilot records command consumption in the release dashboard. At 70% of the free monthly allowance, the operator either reduces nonessential cache traffic or moves to pay-as-you-go with a budget cap. Redis inactivity archival and absence of a free-plan SLA are accepted personal-phase risks.

## Identity and Secret Handling

Separate service accounts are created for frontend, backend, migration, and deployment. Each receives only its required roles:

- Frontend: invoke backend.
- Backend: connect to Cloud SQL; access runtime secrets; read/write its assigned buckets; invoke Docling, embeddings, and renderer.
- Renderer: read the template bucket and access only its internal token secret.
- Migration: connect to Cloud SQL and access database credentials.
- GitHub deployment identity: push Artifact Registry images, run migrations, update Cloud Run revisions, and read deployment metadata; it cannot read user runtime secrets.

GitHub Actions authenticates using OIDC Workload Identity Federation restricted to the exact repository and protected `master` production branch. No downloaded service-account key is created. Google recommends federation for deployment pipelines to avoid long-lived service-account keys: <https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines>.

Secret Manager stores `DATABASE_URL`, `JWT_SECRET`, `LLM_CONFIG_ENCRYPTION_KEY`, `RENDERER_INTERNAL_TOKEN`, `REDIS_URL`, `JINA_API_KEY`, SMTP credentials, and the one-time bootstrap password. Services reference explicit secret versions. Rotation creates a new version, deploys compatible consumers, verifies them, and then disables the old version. The LLM encryption key is backed up separately before rotation because losing it makes saved per-user provider keys unrecoverable.

## Account Bootstrap and Email

Public registration stays disabled. The `docai-bootstrap-user` Cloud Run Job accepts username, email, and password from Secret Manager, applies the same application validation and bcrypt cost as registration, creates the account only when no matching identity exists, and never prints credentials. After successful login verification, the bootstrap password secret version is disabled.

Password reset must be functional before launch. SMTP uses authenticated TLS on port 587 or a provider HTTPS API; port 25 is not assumed. Reset links use the public frontend `run.app` origin, tokens retain the application's one-time and expiry rules, and logs redact email addresses and tokens.

## Delivery Pipeline

### Pull Requests

The required checks run without cloud mutation:

1. Backend tests, Prisma validation, schema synchronization, migration-contract tests, TypeScript build, and production dependency audit.
2. Frontend tests, lint, typecheck, production build, and production dependency audit.
3. Renderer tests and Release build.
4. Python service tests and bytecode compilation.
5. Terraform formatting and validation.
6. Container builds and vulnerability scanning.
7. Compose and repository-hygiene contracts.

### Production Deployment

Merges to the protected production branch run this ordered pipeline:

1. Authenticate through Workload Identity Federation.
2. Build every changed image and push it to Artifact Registry under the immutable Git commit SHA; never deploy `latest`.
3. Apply Terraform changes using a reviewed plan artifact.
4. Run the migration job and stop on failure.
5. Deploy private processing services.
6. Deploy backend and frontend revisions without immediately replacing all traffic.
7. Run authenticated smoke checks against revision tags: liveness, complete readiness, login, settings load, template list, and a small fixture document through ingestion and rendering.
8. Promote 100% traffic only after smoke checks pass.
9. Record image digests, revision names, migration identifiers, and smoke-test evidence in the workflow summary.

Rollback moves frontend and backend traffic to the previous compatible revisions and reruns smoke checks. Failed migrations do not receive application traffic. Incompatible data changes require restoring the pre-deployment backup into a new Cloud SQL instance and redeploying against the restored connection.

## Observability and Operations

The backend replaces ad-hoc console output with structured Pino JSON carrying timestamp, severity, service, revision, request ID, route, status, duration, user ID hash, worker/job ID, and safe error code. It never logs cookies, passwords, reset tokens, LLM keys, SMTP credentials, authorization headers, document contents, or raw upstream payloads. Frontend server routes emit the same request ID when proxying to the backend.

Cloud Monitoring provides:

- Public uptime check for the frontend.
- Alerts for frontend/backend 5xx rate, backend p95 latency, unhealthy readiness, worker failures, Cloud Run instance saturation, Cloud SQL CPU/storage/connections, and failed migration or deployment workflows.
- A dashboard for request volume, latency, errors, active revisions, processing duration, failed jobs, database health, Redis command usage, and trial-credit consumption.
- Billing budgets at `$50`, `$150`, `$225`, and `$275` with email and Pub/Sub notifications.

Maximum instances are the primary workload cost guard. Budget alerts do not stop resources automatically. No automated production shutdown is introduced because it could corrupt active document work; the operator receives an actionable runbook instead.

## Backup, Recovery, and Retention

- Cloud SQL: daily automated backups, point-in-time recovery, seven retained backups, and a manual pre-deployment backup before risky migrations.
- Cloud Storage: object versioning and 30-day noncurrent-version lifecycle for uploads and templates; RAG reports expire after 30 days while manifests remain.
- Secrets: encrypted offline record of the LLM encryption key and deployment recovery steps.
- Recovery objective for the personal pilot: restore service within four hours with at most 24 hours of data loss, except where point-in-time recovery provides a smaller loss window.

Before public launch, the operator restores the latest database backup to a disposable Cloud SQL instance, verifies Prisma migration state and ownership integrity, confirms representative documents/templates, and deletes the disposable instance. The restore evidence is stored with the release record without data contents.

## Failure Behavior

- A failed dependency causes `/ready` to return 503 with component status; `/live` remains process-only.
- A processing service cold start surfaces as a bounded pending state, not an infinite request. Timeouts preserve retryable job state.
- If Redis is unavailable, rate limiting and transient coordination fail closed for expensive operations; Redis is not reported healthy through an in-memory fallback.
- If Cloud Storage is unavailable or unwritable, uploads and generation fail before database records claim success.
- A migration, smoke-test, or vulnerability-scan failure blocks promotion.
- An exhausted trial credit or closed billing account stops Google Cloud resources. The October exit decision is therefore a release gate rather than an informal reminder.

## Cost Envelope

For the period from August 9 through October 1, the target spend is `$130–$220`, leaving at least `$80` of the trial credit as safety margin. The largest fixed costs are the continuously allocated backend and Cloud SQL. Processing services scale to zero and are bounded to one instance.

The deployment is considered over budget when forecast trial usage exceeds `$225` or daily spend projects the credit to expire before September 25. The operator then reduces warm capacity, pauses nonessential load tests, or advances the post-trial migration decision. External Gemini, Jina, SMTP, and domain charges are tracked separately.

## October 1 Exit Gate

By September 15, the operator chooses and tests one of these paths:

1. Upgrade to paid Google Cloud billing and keep the pilot architecture.
2. Move PostgreSQL to Neon, keep Upstash, refactor polling workers into Cloud Tasks or Jobs, and allow all Cloud Run services to scale to zero.
3. Export and shut down the pilot.

By September 25, the selected path completes a rehearsal. If no path is approved, the default action is an encrypted database export, bucket inventory and export, secret recovery verification, and a controlled shutdown before the trial closes. Google states that non-upgraded trial projects stop when the credit or trial period ends: <https://cloud.google.com/free/docs/free-cloud-features>.

## Testing Strategy

Implementation uses red-green TDD for every behavior change. Automated coverage includes Cloud Run ID-token injection, private-service denial without identity, production Redis fail-closed behavior, storage write/read probes, bootstrap idempotency, migration-job ordering, log redaction, readiness distinctions, and deployment rollback decisions.

Infrastructure tests parse Terraform plans and deployed service descriptions to assert region, IAM, public/private exposure, min/max instances, CPU allocation, concurrency, probes, secret references, Cloud SQL attachment, bucket mounts, and immutable image tags. No test asserts only on source text when a rendered plan or runtime behavior is available.

Pre-launch verification includes the repository's full verifier, disposable Cloud SQL migration rehearsal, container scans, restore drill, authenticated Chrome workflow, concurrent two-document processing, SSE completion, password reset, and a live smoke document whose data is removed after verification.

## Success Criteria

The personal production pilot is ready when all of the following are true:

1. The frontend is publicly reachable over HTTPS, while backend and processing services reject unauthenticated direct calls.
2. Login, logout, password reset, LLM settings, upload, ingestion, template compilation, generation, rendering, document download, and Q&A work against production dependencies.
3. Cloud SQL migrations run once in the deployment job and never race at application startup.
4. Templates, uploads, and RAG state survive service replacement and are covered by retention and recovery procedures.
5. Secrets are sourced from Secret Manager and GitHub uses Workload Identity Federation without a service-account key.
6. Pull-request and production pipelines block on tests, builds, audits, scans, migrations, smoke checks, and infrastructure validation.
7. Logs are structured and redacted; dashboards, availability/error alerts, worker alerts, and budget notifications are active.
8. A database restore drill and application rollback rehearsal have passed.
9. Maximum-instance settings prevent runaway scaling, and forecast spend stays below `$225` through October 1.
10. The September 15 post-trial decision and September 25 rehearsal are represented as tracked release gates.

## Deliberately Deferred to the Small-Beta Phase

- Multi-region or multi-zone application availability.
- Cloud SQL HA or read replicas.
- More than one backend API replica.
- Separate continuously running worker pools.
- Cloud Tasks/Eventarc conversion of every background job.
- Direct Cloud Storage client adapters and multi-writer object preconditions.
- Public self-registration, organization management, or administrative roles.
- Formal uptime SLA, on-call rotation, and 24/7 incident response.
- Kubernetes, GKE, service mesh, or a dedicated load balancer.
