# Conversion Service — Standalone

PDF → DOCX conversion for Vietnamese administrative documents per **Nghị định
30/2020/NĐ-CP**. Fully independent project: own git history, own Docker images,
own volumes, own .env. Nothing here touches the master stack.

---

## Quick Start

### Prerequisites
- **OS**: Windows 11 / Ubuntu 22.04
- **Tools**: Docker, Node.js 22+, Python 3.11+

### One command runs the whole product

```powershell
docker compose up -d --build
```

Services: postgres, redis, storage-init, migrate (one-shot), conversion,
conversion-worker, backend, frontend.

- **frontend**: http://localhost:3000 (product UI)
- backend: http://localhost:3001 (health: /health)
- conversion: http://localhost:8004 (health: /health)

### First user

```powershell
docker compose run --rm `
  -e BOOTSTRAP_USERNAME=admin `
  -e BOOTSTRAP_EMAIL=admin@example.local `
  -e BOOTSTRAP_PASSWORD='ChangeMe!123' `
  backend node dist/scripts/bootstrap_user.js
```

Then log in at http://localhost:3000/login.

### Development (hot reload)

```powershell
# Backend
cd backend && npm install && npm run dev   # Port 3001

# Frontend
cd frontend && npm install && npm run dev  # Port 3000

# Conversion service
cd conversion-service
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-dev.txt
.venv\Scripts\python.exe -m uvicorn main:app --port 8004
```

---

## Architecture

```
frontend (/api/proxy) ──► backend POST /api/convert ──► [quota, validate]
        │                                                    │
        └── poll GET /api/convert/:jobId ◄── Redis conversion_queue
                                            │
                                conversion-worker (BRPOPLPUSH)
                                            │
                                   pipeline → DOCX + report
```

- **Queue mode**: backend enqueues jobs to Redis; the worker consumes them via
  BRPOPLPUSH (crash-safe: processing list + startup reclaim). Terminal-state
  LREM removes completed jobs.
- **Daily quota**: 20 docs/user/day, charged only after PDF validation passes.
  Failed conversions refund quota (Redis SET NX EX dedup flag).
- **Owner scope**: GET /:jobId, /:jobId/report, /:jobId/result all assert job
  ownership. Unknown and not-yours both return 404.
- Docling / embeddings / document-renderer are **not** part of this project.
  Backend /health may report degraded; that's expected here.

### Service Ports

| Service | Port |
|---------|------|
| Frontend (Next.js) | 3000 |
| Backend (Express.js) | 3001 |
| Conversion (FastAPI) | 8004 |
| PostgreSQL | 5432 |
| Redis | 6379 |

---

## Technology Stack

### Backend (TypeScript 7)
- **Runtime**: Node.js 22+ with Express.js + TypeScript 7
- **Database**: PostgreSQL 15 (plain, no pgvector) via Prisma ORM
- **Cache/Queue**: Redis (job queue, state, quota)
- **Validation**: Zod schemas
- **Logging**: Pino (structured JSON)
- **Resilience**: Circuit breaker, retry with backoff

### Frontend
- **Framework**: Next.js 16 (App Router) + TypeScript 7
- **State**: React Query (TanStack Query)
- **Styling**: Tailwind CSS + Radix Themes
- **Testing**: Vitest + Testing Library
- **Pages**: Landing, Convert, Login/Signup/Forgot/Reset

### Conversion Service (Python 3.11)
- **Framework**: FastAPI + uvicorn
- **PDF**: PyMuPDF (text extraction)
- **DOCX**: python-docx (output generation)
- **Vision**: Google Gemini Flash (scanned pages, optional)
- **Queue**: Redis (BRPOPLPUSH crash-safe consumption)

---

## Key Files & Structure

```
├── backend/
│   ├── prisma/schema.prisma          # User + PasswordResetToken only (ADR-0001)
│   ├── prisma/migrations/            # Single squashed init migration
│   ├── scripts/
│   │   └── check_migration_integrity.test.ts  # Locks the squashed baseline
│   ├── src/
│   │   ├── index.ts                  # Express server (auth + convert only)
│   │   ├── routes/
│   │   │   ├── auth.ts               # Login, register, password reset
│   │   │   ├── convert.ts            # Submit, status, report, result
│   │   │   └── removed_surfaces.contract.test.ts  # Absence assertions
│   │   ├── services/
│   │   │   ├── readiness_service.ts  # Postgres + Redis + conversion only
│   │   │   └── conversion_service_client.ts
│   │   ├── middleware/
│   │   │   ├── user_auth.ts          # JWT auth + owner scope
│   │   │   ├── validation.ts         # Zod input validation
│   │   │   └── ratelimit.ts
│   │   └── utils/
│   │       ├── prisma.ts
│   │       ├── redis.ts
│   │       └── validateEnv.ts        # Standalone env contract
├── frontend/
│   ├── app/
│   │   ├── page.tsx                  # Landing
│   │   ├── (app)/convert/page.tsx    # Convert UI
│   │   ├── (auth)/                   # Login, signup, forgot, reset
│   │   └── api/proxy/[...path]/      # Backend proxy (health + convert only)
│   ├── components/
│   │   ├── convert/                  # Upload dialog, job cards
│   │   ├── auth/                     # AuthForm, RequireSession
│   │   └── layout/                   # Sidebar, AppShell, Header
│   ├── lib/
│   │   ├── convert-api.ts            # Conversion API client
│   │   └── server/backend.ts         # Server-side proxy helper
│   └── test/
│       └── removed-surfaces.test.ts  # Absence contract
├── conversion-service/
│   ├── main.py                       # FastAPI: /convert, /convert/bulk, /health
│   ├── worker.py                     # Redis queue consumer (BRPOPLPUSH)
│   ├── pipeline.py                   # convert_pdf: triage → rules → DOCX
│   ├── job_store.py                  # Job state in Redis with TTL
│   ├── quota.py                      # Per-user daily cap + refund
│   ├── config.py                     # Env config
│   ├── metrics.py                    # Prometheus counters
│   ├── ingest/                       # PDF intake + validation
│   ├── triage/                       # Page classification
│   ├── rules/                        # Decree-30 rule engine
│   ├── structuring/                  # JSON structure extraction
│   ├── vision/                       # Gemini Flash scanned-page OCR
│   ├── eval/                         # E2E + P0a verification
│   └── tests/                        # 50 pytest tests
├── shared/decree30-typography.json   # Single source of Decree-30 typography
├── docker-compose.yml                # Standalone stack (8 services)
├── init.sql                          # Postgres bootstrap (no extensions)
├── ops/
│   ├── verify-all.ps1                # Slim verification suite
│   ├── test-compose.ps1              # Standalone compose contract
│   └── tests/                        # Pester operations tests
└── docs/
    ├── adr/0001-squash-migration-history.md
    └── agents/                       # Issue tracker + triage docs
```

---

## Environment Variables

### Backend (.env)
```
# Required (validateEnv refuses to boot without these)
DATABASE_URL=postgresql://postgres:password@localhost:5432/ai_docs
REDIS_URL=redis://localhost:6379
CONVERSION_SERVICE_URL=http://localhost:8004
JWT_SECRET=<your-jwt-secret-min-32-chars>

# Optional
CORS_ORIGIN=http://localhost:3000
TRUST_PROXY_HOPS=0
NODE_ENV=development
PASSWORD_RESET_MODE=email
DISABLE_PUBLIC_REGISTER=false
ALLOW_STACK_TRACES=false
PRISMA_LOG_QUERIES=false
```

### Frontend (.env.local)
```
BACKEND_API_URL=http://localhost:3001
```
Server-side only — never exposed to client bundle.

### Root (.env) — compose secrets
```
POSTGRES_DB=ai_docs
POSTGRES_USER=postgres
DB_PASSWORD=<your-password>
POSTGRES_VOLUME=standalone_postgres_data
REDIS_VOLUME=standalone_redis_data
GEMINI_API_KEY=          # Optional: scanned-page vision
```

---

## Testing

```powershell
# Backend tests (Jest) — 24 suites / 198 tests
cd backend && npm test

# Frontend tests (Vitest) — 21 files / 184 tests
cd frontend && npm test -- --run

# Conversion service tests (pytest) — 50 tests
cd conversion-service
.venv\Scripts\python.exe -m pytest

# Ops verification (slim suite)
./ops/verify-all.ps1 -ContractsOnly

# Migration integrity
cd backend && npm run test:migrations
```

---

## CI

Five jobs in `.github/workflows/ci.yml`:

| Job | What it does |
|-----|-------------|
| backend | jest + prisma validate + check-schema + test:migrations + build + audit |
| frontend | vitest + lint + build + audit |
| conversion | pytest + compileall |
| containers | Build + Trivy scan: backend, conversion, frontend |
| repository-contracts | Slim ops verify-all (compose + Pester + whitespace) |

---

## Gotchas

- **Backend /health may report degraded** — docling/embeddings/renderer are
  absent by design. The convert path never touches them.
- **Frontend tests use Vitest**, not Jest. Use `npm test` in the frontend directory.
- **Backend `predev` script** runs `prisma migrate deploy` automatically.
- **node:22-alpine ships no curl** — healthchecks use Node's global fetch.
- **Quota refund** uses a Redis SET NX EX dedup flag to prevent double-refund.
- **BRPOPLPUSH** moves jobs to a processing list; startup reclaim re-enqueues
  any jobs left there after a crash.

---

## Related Documentation

- [ADR-0001: Squash migration history](docs/adr/0001-squash-migration-history.md)
- [Issue tracker conventions](docs/agents/issue-tracker.md)
- [Triage labels](docs/agents/triage-labels.md)
- [Domain glossary](CONTEXT.md)
- [Product register](PRODUCT.md)
