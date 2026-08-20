# P4 Production Cutover Checklist — Conversion Service

Run `python eval/preflight.py --url http://<host>:8004` first; it must report
**PREFLIGHT: PASS** before proceeding.

## 1. Prerequisites

- [ ] Docker Compose stack up: `docker compose up -d redis conversion conversion-worker backend`
- [ ] `conversion` and `conversion-worker` both `healthy` (`docker compose ps`)
- [ ] Backend env has `CONVERSION_SERVICE_URL=http://conversion:8004`
- [ ] Backend env has `LLM_CONFIG_ENCRYPTION_KEY` (64 hex chars) — BYOK vision
      keys are stored AES-256-GCM encrypted; the backend refuses to boot without it
- [ ] Scanned-PDF support is BYOK: users configure their own Google Gemini key
      in the app's settings dialog. Scanned uploads without a key are rejected
      up front (422) and cost no quota — no server-side key exists.
- [ ] Redis reachable from both services (queue mode shows `queueMode: true` on `/health`)

## 2. Smoke tests (post-deploy)

- [ ] `GET /health` → `{"status":"healthy","queueMode":true,"alerts":[]}`
- [ ] `GET /ready` → 200
- [ ] `GET /metrics` → Prometheus text (counters present after first job)
- [ ] Upload one digital PDF through the UI → job reaches `completed`,
      DOCX downloads and opens in Word
- [ ] Upload one password-protected PDF → friendly 422, no job created
- [ ] Upload a non-PDF file → 400 from backend before reaching the service
- [ ] Bulk upload (2+ files) → one job per file, per-file errors surfaced
- [ ] Open "Xem kết quả kiểm tra độ tin cậy" on a finished job → report panel
      renders confidence, demotions, flagged blocks
- [ ] Quota: exceed `DEFAULT_DAILY_LIMIT` (20/day) for one user → 429 with
      friendly message; other users unaffected

## 3. Observability

- [ ] Scrape `/metrics` into your monitoring stack (Prometheus format)
- [ ] Alert rule: `conversion_failure_rate > 0.2` over the last 50 jobs
      (mirrors the service's own `/health` alert)
- [ ] Alert rule: `conversion_queue_depth` growing for > 10 minutes
      (worker stalled)
- [ ] Log check: worker emits one structured line per job with duration

## 4. Rollback

The conversion service is the product's only processing path; stopping it
stops conversions but never loses data.

1. `docker compose stop conversion-worker conversion` — backend returns 502
   "Conversion service unavailable" (circuit breaker opens after 3 failures,
   half-opens after 60 s).
3. No schema migrations to revert; job state lives in Redis with 24 h TTL and
   self-expires. Uploaded/converted files live in the `conversion_work`
   volume; drop the volume only after confirming no in-flight jobs.

## 5. Known limitations at cutover

- Scanned-page quality (P1) is uncertified without a real scanned corpus +
  a user-supplied Gemini key; digital-path quality is certified (P0a gate 57/57).
- Queue-mode end-to-end requires Redis; without it the service runs
  in-process (dev fallback) and does not survive restarts.
- Scanned batches use the synchronous per-batch Gemini path (≤ 8 pages per
  call, 4–8 calls in parallel).
