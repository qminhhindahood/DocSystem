# Agent handoff

Latest state first. Each entry: what changed, how verified, where it lives.

## 2026-01 — Tickets 07–08 resolved (production-readiness run, continued)

- **07 (`1d1009b`) Cloudflare frontend via OpenNext**:
  next 16.2.11→16.3.3 (adapter 1.20.4 peer floor),
  @opennextjs/cloudflare + wrangler.jsonc (nodejs_compat,
  global_fetch_strictly_public, assets binding, worker self-reference;
  no R2/images — app uses no next/image, no ISR), open-next.config.ts
  (defineCloudflareConfig). **The verification caught a real bug**: both
  backend.ts and the proxy route captured BACKEND_API_URL into module-load
  consts — on Workers env vars land in process.env at request time, so the
  value would freeze to the localhost fallback and every proxied request
  would 502 in production. Fixed to per-call backendUrl() reads; PROVEN
  under wrangler dev/workerd (worker fetched the exact .dev.vars target);
  locked red-first by vitest (backend.test.ts 4, proxy-route-env.test.ts
  3) + Pester source contracts (CloudflarePages.Tests.ps1 7). BACKEND_API_URL
  is a dashboard runtime variable (Pester forbids wrangler vars). CI
  frontend job builds the worker. Scripts build:worker/preview:worker.
  Human steps left (need the real Cloudflare account): git-integration
  connect, custom domain, prod variable, live >4.5MB upload + cookie-flag
  checks — runbook §7.1/§7.4 + cutover checklist.
- **08 (`6a41fb0`) Cutover gate + monitoring**:
  CUTOVER_CHECKLIST.md rewritten as the full hard gate (prod overlay
  stack-up, preflight PASS paste box, smoke battery incl. >4.5MB proof +
  legacy-TCVN3 + fidelityLedger, backup/admin-reset exercises, human
  sign-off, rollback, honest limitations). **Preflight PROVEN**:
  PREFLIGHT: PASS (7/7) from the repo clone against the live container —
  with the operational discovery that preflight must run from the VM
  clone, not docker exec (lean image ships no eval/scripts/shared;
  typography sync needs the repo layout). Runbook §8: exact monitoring
  setup (UptimeRobot 3× /health, Grafana Cloud free tier via VM
  Prometheus, two PromQL alert rules, Alertmanager Telegram+email) with
  the daily manual fallback until the user supplies bot token/chat
  ID/email. Pester CutoverGate.Tests.ps1 12/12.
- **Verified (all run this session)**: pytest 202/202, frontend vitest
  236/236, backend jest 278/278, ops Pester 76/76 (57 + 7 + 12),
  opennextjs-cloudflare build clean, whitespace clean, no secrets in the
  diff (npm integrity hashes only), .dev.vars untracked.
- **Remaining (all user-owned by design)**: walk CUTOVER_CHECKLIST.md on
  the real VM + Cloudflare dashboard steps + the real-PDF sign-off;
  monitoring materials; legacy real-corpus eval (20–50 PDFs).

## 2026-08-29 — Tickets 02–06 resolved (production-readiness run, one session)

Five tickets, TDD throughout, committed individually on
`codex/complete-remediation`:

- **02 (`55a3903`) Nightly Postgres backup + restore drill**:
  `ops/backup/postgres-dump.sh` (pg_dump -Fc, 30-day retention, 1 KiB size
  guard, set -euo pipefail) + `sync-to-gcs.sh` (gcloud rsync, never
  deletes); runbook §1–§4; restore drill PROVEN end-to-end (real
  postgres:15-alpine container, 2 users + 1 BYOK config restored,
  counts match — logged in ops/backup/DRILL-LOG.md). Drill found the
  pwsh `>` binary-corruption trap (documented, in-container paths only).
- **03 (`6cb25bd`) Admin password reset**: reset_operator_password.ts
  pre-existed fully tested; ticket reduced to an end-to-end container
  drill from the real backend image (old password false/new true,
  sessionVersion 0→1 invalidating JWTs, refuses disabled/ambiguous).
- **04 (`873bcb9`) Lossless TCVN3/VNI decode**:
  `conversion-service/legacy/decode.py` — tables cross-validated
  against TWO independent published sources (73/73 single-byte
  agreement); decode_best guards: health-gain + byte-identical
  round-trip (keeps healthy Unicode out despite Latin-1 overlap) +
  composite-pair discriminator (VNI vs TCVN3). triage LEGACY_TEXT
  class; pipeline decodes per line (geometry preserved); main.py
  admission gate admits legacy PDFs without Gemini key. Fixtures are
  GENERATED from the tables (hand-typing mojibake failed twice).
  Known limit: mixed legacy+Unicode pages fall back to SCANNED
  (honest tier-3). Real-corpus certification still open.
- **05 (`b82c0df`) Per-job fidelity ledger**: `fidelity.py` — bag
  (multiset) fidelity on case-folded whitespace-collapsed text; probe
  showed ordered CER false-alarms at 0.69 on VERBATIM docs (reordering
  + Decree-30 uppercase), bag scores 1.0 exactly. Surfaces in
  /convert/:id/report as fidelityLedger with capped divergence spans +
  stated normalization. Scanned jobs: ledger None (no fake numbers).
  Drift <0.99 increments existing failure counters (worker + sync).
- **06 (`92a686c`) VM deployment composition**:
  docker-compose.prod.yml (caddy:2-alpine 80/443, backend hardened
  SESSION_COOKIE_SECURE/TRUST_PROXY_HOPS=1/CORS_ORIGIN :? guard,
  frontend behind never-activated "cloudflare-only" profile) +
  Caddyfile (route{request_body 64MB; reverse_proxy backend:3001}) —
  empirically validated against the real caddy image ("Valid
  configuration"; caught the request_body-needs-route and
  empty-API_DOMAIN-label traps). Runbook §6 (setup/first-boot/deploy/
  rollback). 15 Pester checks; ops directory 57/57.
- **Verified**: pytest 202/202, jest 278/278, vitest 229/229, Pester
  57/57, merged compose config validates, whitespace clean, no secrets
  in the diff (drill scratch values + detector patterns only).
- **Remaining**: tickets 07 (Cloudflare Pages/OpenNext frontend) and
  08 (cutover gate + monitoring) are OPEN and untouched — the user
  scoped this run "until ticket 6". Legacy real-corpus eval (20–50
  PDFs) awaits user materials.

## 2026-08-29 — Ticket 01 resolved: QUOTA_DAILY_LIMIT env var (production-readiness)

- **What**: Daily quota env-configurable. `conversion-service/config.py`
  gains `_daily_quota_limit()` (strict int, >0, fail-fast on bogus — never
  silent) → `DAILY_QUOTA_LIMIT` (default 50). `quota.py`
  `DEFAULT_DAILY_LIMIT = config.DAILY_QUOTA_LIMIT`, so every QuotaService
  construction site (main.py:96, worker.py:48/220) inherits the env value via
  the constructor default — no per-site wiring needed. Backend upload limiter
  retuned 20→60/15min (burst headroom above 50/day), env-tunable via
  `UPLOAD_RATE_LIMIT_MAX` (strict decimal parse — rejects hex/scientific,
  mirroring Python `int()`).
- **Why**: Ticket 01 of
  `.scratch/production-readiness/issues/01-quota-env-var.md` — pilot quota
  policy from the production-readiness grilling (spec:
  `.scratch/production-readiness/spec.md`, ADR-0002).
- **Verified**: TDD red→green; new tests test_quota_config.py (11),
  ratelimit.config.test.ts (6); full suites 163/163 pytest, 278/278 jest,
  tsc build clean. Code review (standards + spec axes, run directly after
  subagent rejection): fixed env-var registry omission in CLAUDE.md and
  non-decimal Number() parse; regression cases added for both.
- **Where**: commit `feat(quota): QUOTA_DAILY_LIMIT env var, default 50
  (ticket 01)` on `codex/complete-remediation`, after 0b87502. Ticket file
  resolved. Remaining tickets 02–08 open under
  `.scratch/production-readiness/issues/`.

## Standing instructions for the next agent

- Work tickets blockers-first: 01→08 (08 blocks on all).
- TDD strictly: red first, then minimal green; full suite at the end.
- Optimize Coding Mode rejects subagents — run code-review's two axes
  directly when the diff is small; ask the user before any delegation.
- Approvals are disabled this session: denied ops are final; don't retry or
  set `sandbox_permissions` on retry.
- Docker Desktop file-sharing allowlist is still broken on this host —
  full-stack `docker compose up` requires fixing Settings → Resources →
  File Sharing first (host config, not a repo defect).
