# Production Cutover Checklist — Conversion Service (standalone)

Hard gate: do not switch the pilot users over until EVERY box here is
checked and dated. Run `python eval/preflight.py --url
http://127.0.0.1:8004` (from the repo clone on the VM — the URL is the
compose-network port; preflight needs the clone for the typography
sync check) first; it must report **PREFLIGHT: PASS** before proceeding.

Execution date: ____  Executed by: ____

## 1. Stack up (VM, prod overlay — runbook §6)

- [ ] `docker compose -f docker-compose.yml -f docker-compose.prod.yml
      config --quiet` exits 0 (env guard satisfied — CORS_ORIGIN set)
- [ ] `docker compose -f docker-compose.yml -f docker-compose.prod.yml
      up -d --build` — all services `healthy` (`docker compose ps`)
- [ ] Frontend container NOT started on the VM (Cloudflare owns it —
      `docker compose ps` shows no `frontend` row)
- [ ] Caddy edge up: `curl -s https://api.<domain>/api/health` returns
      backend health JSON over TLS (ACME cert issued)
- [ ] Backend env has `CONVERSION_SERVICE_URL=http://conversion:8004`,
      `SESSION_COOKIE_SECURE=true`, `TRUST_PROXY_HOPS=1`,
      `CORS_ORIGIN=https://app.<domain>`
- [ ] `LLM_CONFIG_ENCRYPTION_KEY` set (64 hex) — BYOK keys are stored
      AES-256-GCM encrypted; the backend refuses to boot without it
- [ ] Scanned-PDF support is BYOK: users add their own Gemini key in the
      settings dialog; scanned uploads without a key are 422 before quota
- [ ] Redis reachable from both services (`queueMode: true` on /health)

## 2. Preflight gate

- [ ] `PREFLIGHT: PASS` output captured (paste below)

  ```
  <paste preflight output here>
  ```

## 3. Smoke tests (through the Cloudflare frontend — production path)

- [ ] `https://app.<domain>` loads (landing, no console errors)
- [ ] Login works; login `Set-Cookie` shows `Secure; HttpOnly; SameSite=Lax`
- [ ] Upload >4.5MB digital PDF through the UI → job `completed`, DOCX
      downloads and opens in Word (proves Cloudflare body limit ≫ 4.5MB)
- [ ] Upload one password-protected PDF → friendly 422, no job created,
      no quota charged
- [ ] Upload a non-PDF file → 400 from the backend before the service
- [ ] Bulk upload (2+ files) → one job per file, per-file errors surfaced
- [ ] Fidelity report opens on a finished job ("Xem kết quả kiểm tra
      độ tin cậy"): confidence, demotions, flagged blocks, fidelityLedger
- [ ] Quota: exceed `QUOTA_DAILY_LIMIT` for one user → 429 friendly
      message; other users unaffected
- [ ] Legacy TCVN3/VNI PDF converts with correct Vietnamese diacritics
      (tier-2 lossless decode; report shows LEGACY_TEXT demotion)

## 4. Observability (runbook §8)

- [ ] `curl -s https://api.<domain>/api/health` → `alerts:[]`
- [ ] `/metrics` reachable (Prometheus text; counters after first job)
- [ ] Until Telegram/email wiring (materials pending): set the two alert
      rules as runbook manual checks — `conversion_failure_rate > 0.2` and
      `conversion_queue_depth` growing >10 min, checked daily

## 5. Backup + admin ops

- [ ] Nightly dump present: `ops/backup/postgres-dump.sh` ran, latest
      `~backups/dump-*.dump` non-empty (>1 KiB guard)
- [ ] Restore drill completed once on a scratch container (DRILL-LOG.md
      procedure) — user + BYOK config counts match
- [ ] Admin password reset exercised once on production (or staging VM):
      `docker compose run --rm backend node dist/scripts/reset_operator_password.js`,
      old JWT invalid after reset (sessionVersion bump)

## 6. Human-verified conversion

- [ ] The pilot owner uploads a REAL administrative PDF (their own
      document) through https://app.<domain> and confirms the DOCX is
      faithful — sign-off below.

  Sign-off: ________  Date: ________

## 7. Rollback (known, rehearsed)

The conversion service is the only processing path; stopping it stops
conversions but never loses data. Migrations are forward-only
(ADR-0001); restore from nightly dump is the last resort (§3 runbook).
`docker compose down` (NEVER `-v`) keeps all named volumes.

## 8. Known limitations at cutover (accepted)

- Scanned-page quality (tier 3) is fixture-certified only; real-corpus
  certification awaits 20–50 real scanned PDFs.
- Legacy decode (tier 2) is fixture-certified (table-generated); mixed
  legacy+Unicode pages fall back to tier 3.
- Queue mode requires Redis; without it the service runs in-process
  (dev fallback) and does not survive restarts.
- Monitoring alerts are manual checks until Telegram/email materials
  arrive (the single remaining manual step — exact setup commands in
  runbook §8).
