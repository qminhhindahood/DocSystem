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
