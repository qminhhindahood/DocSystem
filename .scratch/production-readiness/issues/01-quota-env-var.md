# 01 — Quota becomes env-configurable (QUOTA_DAILY_LIMIT, default 50)

Status: claimed
Blocked by: (none)

## Why

The daily quota is hardcoded: `DEFAULT_DAILY_LIMIT = 20` in
`conversion-service/quota.py`. The pilot needs ~50 docs/user/day (Q6/Q11).
Keeping the quota *mechanism* matters: it also guards a user's own BYOK
Gemini spend (scanned pages × API calls) and system load. Removing it would
let one user's runaway script burn their Gemini key uncapped.

## Scope

- `conversion-service/quota.py`: `DEFAULT_DAILY_LIMIT` → read
  `QUOTA_DAILY_LIMIT` env var (int > 0, fallback 50, invalid values fail
  fast).
- Wire construction sites (`worker.py`, `main.py`) so every QuotaService
  instance honors the env var (constructor injection via `config.py`).
- `backend/src/middleware/ratelimit.ts`: retune the upload limiter from
  20/15min so a 50/day user converting in a burst isn't rate-limited
  (proposed 60/15min, configurable via env).

## Acceptance

- [ ] New test: env absent → limit is 50 (not 20).
- [ ] New test: `QUOTA_DAILY_LIMIT=7` → limit is 7.
- [ ] New test: `QUOTA_DAILY_LIMIT=bogus` → raises/fails fast, no silent 20.
- [ ] New test: upload limiter honors its env var (pilot-burst headroom).
- [ ] Full suites green: conversion pytest (128), backend jest (246).
- [ ] No other behavior change (refund semantics untouched).
