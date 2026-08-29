# Agent handoff

Latest state first. Each entry: what changed, how verified, where it lives.

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
