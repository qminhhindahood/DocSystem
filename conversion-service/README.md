# conversion-service

Lightweight Python (FastAPI) microservice that converts scanned/mixed/digital
PDFs into faithful, well-structured DOCX files compliant with
**Nghị định 30/2020/NĐ-CP**, for 10–50 users. Design source of truth:
`CONVERSION_SERVICE_PLAN.md` (v6) in the repo root.

**Core principle:** the LLM *transcribes and classifies* — it never *writes*
or *formats*. A validated JSON contract is the boundary between every stage.
Styling that Decree 30 makes deterministic is applied by a **rule engine**,
never the LLM.

## Architecture

```
PDF upload → Ingest (magic bytes, size, password rejection)
           → Triage (multi-signal per page: SCANNED | TABLE_HEAVY | DIGITAL_TEXT)
           → Structure (text: 4-stage classifier cascade + hierarchy state machine;
                        scanned: Gemini Flash vision contract)
           → Assembly (cross-page stitching, anchor_block inference, src crop)
           → Rule engine (loads shared/decree30-typography.json)
           → DocxBlockBuilder (python-docx; wp:anchor floating seals)
           → DOCX + confidence report + degraded-page list
```

No RAG. No embeddings. No 2-stage generation. No feedback loop.

## Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/convert` | Upload a PDF, start a job → `{ jobId }` |
| GET | `/convert/{jobId}` | `{ status, progress, resultUrl, confidence, degradedPages }` |
| GET | `/convert/{jobId}/result` | Download the rendered DOCX |
| GET | `/health` | Liveness probe |
| GET | `/ready` | Readiness probe (typography loads, work dirs writable) |

Job statuses: `queued` → `processing` → `completed` |
`completed_with_warnings` | `failed` (plan §11: failed only if > 30% of
pages degrade or page 1 fails).

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | — | Gemini Flash API key (scanned pages). Never hardcoded, never logged. |
| `CONVERSION_GEMINI_MODEL` | `gemini-2.5-flash` | Vision model |
| `CONVERSION_GEMINI_PARALLEL` | `4` | Parallel Gemini batch calls (4–8) |
| `CONVERSION_PORT` | `8004` | HTTP port |
| `CONVERSION_WORK_DIR` | `./work` | Uploads/outputs/media root |
| `CONVERSION_MAX_FILE_MB` | `50` | Upload size limit |
| `DECREE30_TYPOGRAPHY_PATH` | `../shared/decree30-typography.json` | Canonical typography file |

## Run

```powershell
# from the repo root (worktree)
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r conversion-service\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn main:app --port 8004 --app-dir conversion-service
```

## Tests & eval

```powershell
# unit tests (triage, classifier cascade + state machine, validator, stitcher, rule engine)
.\.venv\Scripts\python.exe -m pytest conversion-service\tests -q

# P0a render gate: fixtures → DOCX → re-open → Decree 30 checklist + wp:anchor seal
.\.venv\Scripts\python.exe conversion-service\eval\verify_p0a.py

# eval harness (CER, block-type F1, seal recall, hallucination rate)
.\.venv\Scripts\python.exe -m eval.run_eval --fixture eval\fixtures\quyet_dinh.json

# typography drift guard (Python rule engine vs TS ROLE_RULES)
.\.venv\Scripts\python.exe conversion-service\scripts\check_typography_sync.py
```

## Typography single source of truth

`shared/decree30-typography.json` is canonical. The Python rule engine loads
it at runtime; the TS generation side keeps its values in sync; the CI check
`scripts/check_typography_sync.py` fails the build on drift.

## Layout

```
conversion-service/
  main.py                  # FastAPI app
  config.py                # env + constants (thresholds from the plan)
  pipeline.py              # per-document orchestration
  schema/                  # JSON contract (blocks.py) + validator.py
  triage/                  # multi-signal page router
  structuring/             # classifier cascade + state machine, zones
  vision/                  # Gemini contract (verbatim plan §6)
  assembly/                # cross-page stitcher
  rules/                   # Decree 30 rule engine
  render/                  # DocxBlockBuilder + wp:anchor helper
  ingest/                  # upload validation + password rejection
  eval/                    # run_eval.py, verify_p0a.py, fixtures/
  tests/                   # pytest unit tests
  scripts/                 # check_typography_sync.py
```

## Phase status

- **P0a — Schema + builder vs fixtures:** ✅ gate passes (Decree 30 checklist
  100%, floating seal `wp:anchor` verified with behindDoc='0', wrapNone,
  page-relative EMU offsets).
- **P0b/P1/P2 modules:** implemented (triage, cascade, vision contract,
  stitcher, confidence, degradation) — exit criteria require real PDF
  corpora + Gemini key to certify.
- **P3 — Backend & UI integration:** ✅ implemented — Redis
  `conversion_queue` worker (`worker.py`, in-memory fallback when Redis is
  down), Express endpoints (`POST /api/convert`, `GET /api/convert/:jobId`,
  `GET /api/convert/:jobId/result`) with JWT auth + per-user quota forwarding,
  Next.js `/convert` page with upload dialog, live progress polling, and
  side-by-side PDF/DOCX preview; per-user daily quota + file TTL. Backend
  contract tests 9/9, frontend 320/320, live HTTP E2E pass.
- **P4 — Hardening:** ✅ implemented — Prometheus `/metrics` + failure-rate
  alert on `/health` (`metrics.py`), confidence-flag review endpoint
  `GET /convert/{jobId}/report` (flagged blocks < 0.6, low-confidence pages
  < 0.7, demotions) with a review panel in the UI, bulk conversion
  `POST /convert/bulk` (≤ 10 files, per-file errors) + multi-file upload
  dialog, Gemini Batch API module (`vision/batch_api.py`) for bulk scanned
  jobs, production preflight (`eval/preflight.py`) and
  `CUTOVER_CHECKLIST.md`. Python 46/46, backend 659/659, frontend 320/320,
  P0a gate 57/57, live E2E (report + bulk + metrics) pass.
