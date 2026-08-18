# Conversion Service — Standalone Project

PDF → DOCX conversion for Vietnamese administrative documents per **Nghị định
30/2020/NĐ-CP**, packaged as a **fully independent project**. This is a complete
copy of the conversion service + backend + frontend integration, with its **own
git history, its own Docker images, its own volumes, and its own .env** — nothing
here touches the master stack or repo.

## What's in the box

| Path | Purpose |
|---|---|
| `conversion-service/` | Python FastAPI microservice (conversion + Redis queue worker) |
| `backend/` | Node/Express BFF API (auth, /api/convert routes, proxy to service) |
| `frontend/` | Next.js UI (convert page: upload, progress, review, download) |
| `shared/decree30-typography.json` | Single source of Decree-30 typography (CI-checked) |
| `docker-compose.yml` | Standalone stack: postgres, redis, conversion, conversion-worker, backend |
| `init.sql` | Postgres bootstrap schema |

## Architecture

```
frontend (/api/proxy) ──► backend POST /api/convert ──► [quota, validate]
        │                                                    │
        └── poll GET /api/convert/:jobId ◄── Redis conversion_queue
                                            │
                                conversion-worker (BLPOP)
                                            │
                                   pipeline → DOCX + report
```

- **Queue mode**: conversion service enqueues jobs when Redis is reachable; the
  worker consumes them. FastAPI deduplicates nothing — the worker owns all jobs.
- **Daily quota**: 20 docs/user/day (config `DEFAULT_DAILY_LIMIT`), charged only
  after PDF validation passes.
- Docling / embeddings / document-renderer are **not** part of this project — the
  `/api/convert` path never touches them (backend `/health` may report degraded;
  that's expected here).

## Quick start

### 1. Docker stack (backend + queue + worker)

```powershell
cd conversion-service-standalone
docker compose up -d --build
```

- backend: http://localhost:3001 (health: http://localhost:3001/health)
- conversion: http://localhost:8004 (health: http://localhost:8004/health)
- frontend proxy: http://localhost:3001/api/convert/...

Secrets: generated fresh into `.env` and `backend/.env` on first setup. Both are
gitignored. Rotate them for any non-local deployment:

```powershell
# regenerate:
$jwt = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | % {[char]$_})
```

### 2. Frontend (dev, on :3000)

```powershell
cd frontend
npm install
npm run dev
```

The frontend proxies `/api/*` to the backend on :3001 automatically.

### 3. First user

Public registration is enabled by default (`DISABLE_PUBLIC_REGISTER=false`), but
if Turnstile blocks headless flow, create a user directly:

```powershell
docker exec -it postgres-container psql -U postgres -d ai_docs
# UPDATE "User" SET "passwordHash" = '<bcrypt hash>' WHERE username = '...';
```

## Ports / volumes / images — all isolated

| Interest | Standalone (this project) | Master stack |
|---|---|---|
| Compose project | `conversion-service-standalone` | `llm` |
| Postgres volume | `${POSTGRES_VOLUME:-standalone_postgres_data}` | `llm_postgres_data` |
| Redis volume | `${REDIS_VOLUME:-standalone_redis_data}` | `llm_redis_data` |
| Images | `standalone/conversion:latest`, `standalone/backend:latest` | `miralph/llm-*` |
| .env secrets | fresh, gitignored | master's own |

Running this project never writes to the master repo, never reuses master's
volumes, and never overwrites master's image tags. If both stacks must run
simultaneously, change the host ports in `docker-compose.yml` (5432/6379/3001/8004)
and point the frontend at the new backend port.

## Layout of the conversion pipeline

`conversion-service/`:

- `main.py` — FastAPI: `/convert` (single), `/convert/bulk` (≤10), `/convert/{id}/report`, `/metrics`, `/health`
- `worker.py` — Redis `conversion_queue` consumer (BLPOP), writes job state + metrics
- `job_store.py` — job state in Redis with TTL (86400s), memory fallback
- `quota.py` — per-user daily cap
- `metrics.py` — Prometheus counters; worker → Redis aggregation → `/metrics`
- `pipeline.py` — `convert_pdf`: triage → rules engine (never LLM) → DOCX
- `ingest/`, `triage/`, `rules/`, `structuring/`, `vision/` — per plan phases P0a–P4
- `eval/` — E2E + preflight verification (`_live_stack_e2e.py`)

## Testing

```powershell
cd conversion-service
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-dev.txt
.venv\Scripts\python.exe -m pytest          # 50 tests

cd ..\backend
npm install && npm test                     # 661 tests

cd ..\frontend
npm install && npm test                     # 320 tests
```

## Plan reference

Implementation follows `CONVERSION_SERVICE_PLAN.md` (P0a → P4). Phase P1
(Gemini scanned-PDF vision) is implemented but requires `GEMINI_API_KEY` +
a scanned-PDF corpus to certify; the digital-text path is fully certified.
Every requirement of the Decree-30 constraints (LLM never formats; validated
JSON contracts; rule engine applies styling) is enforced in code + tests.
