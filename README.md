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
| `docker-compose.yml` | Standalone stack: postgres, redis, storage-init, migrate, conversion, conversion-worker, backend, frontend |
| `init.sql` | Postgres bootstrap schema |

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

- **Queue mode**: conversion service enqueues jobs when Redis is reachable; the
  worker consumes them. FastAPI deduplicates nothing — the worker owns all jobs.
- **Daily quota**: 20 docs/user/day (config `DEFAULT_DAILY_LIMIT`), charged only
  after PDF validation passes.
- **BYOK scanned-page vision**: the server holds no Gemini key. Each user stores
  their own Google Gemini key in the settings dialog (gear icon in the sidebar);
  the backend keeps it AES-256-GCM encrypted and attaches it to the conversion
  job. A scanned upload with no key is rejected up front (422, Vietnamese
  instructions) and costs no quota. Gemini is the only supported provider.
- Docling / embeddings / document-renderer are **not** part of this project — the
  `/api/convert` path never touches them (backend `/health` may report degraded;
  that's expected here).

## Quick start — one command runs the whole product

```powershell
cd conversion-service-standalone
docker compose up -d --build
```

That single command builds and starts everything: postgres, redis, storage-init,
**migrate** (one-shot: applies the single squashed auth migration to a fresh DB
before the backend boots), conversion, conversion-worker, backend, and the
production frontend.

- **frontend: http://localhost:3000** (the product UI — upload, progress, download)
- backend: http://localhost:3001 (health: http://localhost:3001/health)
- conversion: http://localhost:8004 (health: http://localhost:8004/health)

The frontend container is a Next.js standalone production build that proxies
`/api/*` to the backend inside the compose network (`BACKEND_API_URL` is
injected at container start, not baked into the image).

Host ports are overridable via env if another stack holds the defaults:

```powershell
$env:POSTGRES_PORT='5433'; $env:REDIS_PORT='6380'
$env:BACKEND_PORT='3002';  $env:CONVERSION_PORT='8005'
$env:FRONTEND_PORT='3006'
docker compose up -d
```

Secrets live in `.env` and `backend/.env` (both gitignored, already generated).
Rotate for any non-local deployment. The backend refuses to boot without
`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `CONVERSION_SERVICE_URL`, and
`LLM_CONFIG_ENCRYPTION_KEY` (64 hex chars — encrypts users' BYOK API keys;
see `backend/.env.example` for the full contract).

### Frontend development (optional, hot reload)

If you're iterating on the UI, run the dev server instead of the container:

```powershell
cd frontend
npm install
npm run dev
```

The dev frontend proxies `/api/*` to `BACKEND_API_URL` (default
`http://localhost:3001`). If you moved the backend port:

```powershell
$env:BACKEND_API_URL='http://localhost:3002'; npm run dev
```

### First user

```powershell
docker compose run --rm `
  -e BOOTSTRAP_USERNAME=admin `
  -e BOOTSTRAP_EMAIL=admin@example.local `
  -e BOOTSTRAP_PASSWORD='ChangeMe!123' `
  backend node dist/scripts/bootstrap_user.js
```

Then log in at http://localhost:3000/login.

## Ports / volumes / images — all isolated

| Interest | Standalone (this project) | Master stack |
|---|---|---|
| Compose project | `conversion-service-standalone` | `llm` |
| Postgres volume | `${POSTGRES_VOLUME:-standalone_postgres_data}` | `llm_postgres_data` |
| Redis volume | `${REDIS_VOLUME:-standalone_redis_data}` | `llm_redis_data` |
| Images | `standalone/conversion:latest`, `standalone/backend:latest`, `standalone/frontend:latest` | `miralph/llm-*` |
| .env secrets | fresh, gitignored | master's own |

Running this project never writes to the master repo, never reuses master's
volumes, and never overwrites master's image tags. To run both stacks at once,
set the port overrides above (5433/6380/3002/8005) and point the frontend at
the new backend port.

## Layout of the conversion pipeline

`conversion-service/`:

- `main.py` — FastAPI: `/convert` (single), `/convert/bulk` (≤10), `/convert/{id}/report`, `/metrics`, `/health`
- `worker.py` — Redis `conversion_queue` consumer (BRPOPLPUSH + startup reclaim), writes job state + metrics
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
.venv\Scripts\python.exe -m pytest          # 128 tests

cd ..\backend
npm install && npm test                     # 246 tests

cd ..\frontend
npm install && npm test                     # 202 tests
```

Fixture seals are generated artifacts (gitignored). Regenerate before running
the P0a gate on a fresh clone:

```powershell
cd conversion-service
.venv\Scripts\python.exe eval\fixtures\_make_seals.py
.venv\Scripts\python.exe eval\verify_p0a.py   # P0a gate: 57 checks
```

Live full-stack E2E (requires the compose stack running + a logged-in user):

```powershell
cd conversion-service
# token: log in via /api/auth/login, or save a JWT to ..\backend\_test_token.txt
$env:E2E_BASE='http://127.0.0.1:3001'        # backend
$env:E2E_CONVERSION='http://127.0.0.1:8004'  # conversion service
$env:E2E_REDIS='redis://127.0.0.1:6379'
.venv\Scripts\python.exe eval\_live_stack_e2e.py
```

The E2E always verifies the BYOK admission gate (scanned upload with no stored
key → 422, no quota). To also run the fully-real vision path — store a real
Gemini key through the backend, convert a scanned PDF, and download the DOCX —
set `$env:E2E_GEMINI_API_KEY` before running the script.

## Certification status

Phase P1 (Gemini scanned-PDF vision) is implemented as BYOK: the wiring is
unit-tested end to end (real scanned PDF → injected key → re-opened Decree-30
DOCX in `tests/test_vision_wiring.py`), and the live gate
(`eval/_live_stack_e2e.py` with `E2E_GEMINI_API_KEY`) covers the real-key path.
Certifying transcription quality still needs a scanned-PDF corpus + a user's
real key; the digital-text path is fully certified (P0a gate). Every requirement
of the Decree-30 constraints (LLM never formats; validated JSON contracts; rule
engine applies styling) is enforced in code + tests. See
`conversion-service/README.md` for phase status and
`conversion-service/CUTOVER_CHECKLIST.md` for the production checklist.
