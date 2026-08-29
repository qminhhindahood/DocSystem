# Restore drill log

Format: date, dump used, row counts, result, findings (runbook §3).

## 2026-08-29 — drill #1 (ticket 02 acceptance, dev host)

- Dump: custom-format `pg_dump -Fc` of a scratch `drill` DB built from the
  squashed auth migration + 2 sentinel users + 1 sentinel `UserLLMConfig`,
  7970 bytes.
- Restore: fresh `postgres:15-alpine` scratch container, `pg_restore
  --no-owner`. Counts: `User` 2 = 2, `UserLLMConfig` 1 = 1. **PASS**.
- **Finding (fixed)**: the first drill attempt produced an un-restorable
  dump. Root cause: host-side pwsh `>` redirect decodes binary as text and
  re-encodes it — the file kept a valid `PGDMP` header but was corrupt
  past the header. Lesson recorded in runbook §3: in-container paths only,
  `docker cp` to move files, never host-shell redirects for binary dumps.
  Note the scripts (`postgres-dump.sh`) always worked this way; only the
  hand-run drill used the redirect. The VM cron path is unaffected.
- Dev host: Docker Desktop file-sharing allowlist broken (bind mounts
  unavailable), so the drill ran entirely with named volumes + `docker cp`
  — same mechanism production will use.

## 2026-08-29 — admin password-reset drill (ticket 03 acceptance, dev host)

- Scratch `postgres:15-alpine` on a docker network + the real
  `standalone/backend:latest` image running `dist/scripts/reset_operator_password.js`
  with `RESET_USERNAME`/`RESET_PASSWORD`/`DATABASE_URL` env (the exact runbook §5
  command shape). Seeded user `pilot_user` (bcrypt cost 10).
- Results: no-env run **refuses** (exit 1, no secrets echoed); real run
  **succeeds** — `Operator password reset completed for user drill-u1.`;
  `sessionVersion` 0 → 1 (all prior JWTs invalid); bcrypt proof:
  old password `false`, new password `true`; stored hash cost 12 (harder than
  the seed's 10). **PASS**.
