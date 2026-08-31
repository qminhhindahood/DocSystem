# Production Cutover Checklist — DocAI pilot

Hard gate: do not announce the service until every box is checked and dated.
Run this inside the production conversion container first:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T \
  conversion python eval/preflight.py --url http://127.0.0.1:8004
```

It must report **PREFLIGHT: PASS**.

Execution date: ____  Executed by: ____  Exact `origin/main` SHA: ____

## 1. Free-tier host and stack

- [ ] OCI instance is `VM.Standard.A1.Flex`, exactly **2 OCPU / 12 GB**, in
      the tenancy home region and labeled Always Free.
- [ ] Operator accepts that Oracle can reclaim an idle VM; no artificial load
      is used, and the encrypted rebuild/restore path has been rehearsed.
- [ ] `docker compose -f docker-compose.yml -f docker-compose.prod.yml
      config --quiet` exits 0.
- [ ] `ops/deploy-production.sh <main-sha>` deployed the exact current
      `origin/main` commit and passed three consecutive health rounds.
- [ ] All VM services are healthy; no `frontend` container runs on the VM
      because the Cloudflare Worker owns the frontend.
- [ ] `https://api.<domain>/health` returns healthy backend JSON over TLS.
- [ ] Backend has `CONVERSION_SERVICE_URL=http://conversion:8004`, secure
      cookies, one trusted proxy hop, and `CORS_ORIGIN=https://app.<domain>`.
- [ ] Redis queue mode is active, `CONVERSION_MAX_QUEUE_DEPTH=100`, and daily
      quota is 50.

## 2. Public identity, registration, and preflight

- [ ] `PREFLIGHT: PASS` output captured below.

  ```text
  <paste preflight output here>
  ```

- [ ] Public policy values read DocAI, Vietnam, and effective 2026-08-31.
- [ ] `support@<domain>` routes through Cloudflare Email Routing to the
      owner's verified inbox; no fake address remains.
- [ ] Public registration is open behind a hostname-restricted Turnstile
      widget; signup without a valid token is rejected.
- [ ] Password reset is visibly disabled and the UI explains that operator
      assistance is required.

## 3. Production-path smoke tests

- [ ] `https://app.<domain>` and `/api/live` load without console errors.
- [ ] Login cookie shows `Secure; HttpOnly; SameSite=Lax`.
- [ ] A digital PDF larger than 4.5 MB completes and its DOCX opens in Word.
- [ ] Bulk upload: two or more selected files create independent per-file requests and
      jobs; duplicate filenames remain distinct and partial failures surface.
- [ ] Status uses five-second polling; conversion execution time is unaffected.
- [ ] Password-protected PDF gives friendly 422, creates no job, and charges
      no quota. A non-PDF gives 400 before conversion.
- [ ] Queue depth 100 returns friendly `QUEUE_BUSY`/503 and does not charge
      quota or leave a saved source file.
- [ ] Exceeding `QUOTA_DAILY_LIMIT` gives one user a friendly 429 while other
      users remain unaffected.
- [ ] Fidelity report shows confidence, demotions, flagged blocks, and
      `fidelityLedger`.
- [ ] Legacy TCVN3/VNI fixture converts with correct Vietnamese diacritics and
      reports `LEGACY_TEXT` demotion.
- [ ] A scanned PDF without a BYOK Gemini key gives 422 before quota; a real
      BYOK key completes one scan conversion.

## 4. Monitoring and alerts

- [ ] `ops/monitoring/collect-health.sh` returns four numeric metrics.
- [ ] OCI custom metrics arrive under namespace `docai` every five minutes.
- [ ] OCI alarms exist for queue >=80/10m, disk >=80%/15m, backup age
      >=129600s, and unhealthy containers >=1/5m.
- [ ] GCP uptime checks cover `https://app.<domain>/api/live` and
      `https://api.<domain>/health`.
- [ ] The owner's OCI email subscription is confirmed and one deliberately
      triggered test email arrived.

## 5. Encrypted backup and account operations

- [ ] `ops/backup/postgres-dump.sh` produced a non-empty
      `/var/backups/conversion/*.pgdump.age`; no plaintext `*.pgdump` remains.
- [ ] GCS contains the encrypted object, has a 30-day lifecycle, is in an
      eligible US free-tier region, and total stored bytes remain below 5 GB.
- [ ] Restore drill completed on a scratch Postgres; user and BYOK-setting
      counts match and the result is logged in `ops/backup/DRILL-LOG.md`.
- [ ] `reset_operator_password.js` was exercised; the old JWT became invalid
      because `sessionVersion` changed.
- [ ] `manage_users.js` list/disable/enable was exercised on a test account;
      disable revoked its session.
- [ ] Operator deletion requires the exact canonical username, and a separate
      test account completed self-service deletion from Settings.

## 6. Human-verified conversion

- [ ] The owner uploaded a real administrative PDF through
      `https://app.<domain>`, downloaded the DOCX, and judged it faithful.

Sign-off: ________  Date: ________

## 7. Rollback and recovery

- [ ] A failed health rehearsal demonstrated application-only automatic
      rollback to the prior commit/images.
- [ ] Operator understands that database restore, volume deletion, paid
      scaling, and secret rotation require direct approval.
- [ ] VM-loss drill can recreate an Always Free 2 OCPU / 12 GB host from
      `main`, password-manager secrets, and the encrypted GCS dump.
- [ ] `docker compose down -v` is prohibited in production.

## 8. Soft-launch observation

- [ ] Registration stayed open but the URL was unannounced for a full
      **48-hour** observation window.
- [ ] No recurring Cloudflare Worker CPU-limit error, rising queue, stale
      backup, high disk, unhealthy container, or missed alert was observed.

## 9. Known limitations accepted

- Scanned-page quality is not lossless and awaits a 20–50 document real-corpus
  evaluation; it follows the confidence/never-guess policy.
- Legacy decoding is fixture-certified; mixed legacy and Unicode pages can
  fall back to OCR.
- One Always Free VM is a single failure domain with possible reclamation and
  no project-level availability guarantee.
- GCP e2-micro is too small. A paid e2-medium-class fallback is not authorized
  by this checklist.
