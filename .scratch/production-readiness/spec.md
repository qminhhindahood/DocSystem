# Spec: Production Readiness — Conversion Service (Pilot)

Outcome of the 2026-08-29 grill session ("is my project production ready?").
Goal: deploy the standalone PDF→DOCX conversion service for a 3–10 user pilot
on a free-tier hybrid platform with proven backup, configurable quota,
lossless Vietnamese legacy decoding, and the repo's own cutover gate walked
on the real host.

## Settled decisions (grill rounds 1–5)

| # | Decision |
|---|----------|
| Q1/Q15/Q19/Q22 | Hybrid platform: Oracle Always Free ARM VM runs the whole stateful compose stack (postgres, redis, backend, conversion, conversion-worker); frontend on Cloudflare Pages via OpenNext; build-on-VM deploys (`git pull` + `docker compose up -d --build`). Serverless refactor rejected at pilot scale (the worker needs an always-on machine regardless — no free serverless tier hosts it). |
| Q2 | Pilot: 3–10 named internal users, 2–4 weeks before wider rollout. |
| Q3/Q21 | Data loss unacceptable → nightly Postgres `pg_dump` → VM disk → GCS (30-day retention) + monthly restore drill. Uploads/work volumes NOT backed up (user-held, re-derivable; documented caveat). |
| Q4 | Cutover gate is a hard requirement: `eval/preflight.py` PASS + `CUTOVER_CHECKLIST.md` walked on the production host + one real PDF→DOCX verified by a human. |
| Q5/Q16 | Lossless Vietnamese = three-tier definition: (1) digital PDFs — verbatim char extraction (CER<2% gate + new per-job fidelity ledger); (2) TCVN3/VNI legacy fonts — decode via mapping tables, CER=0 on fixtures, OCR only as fallback; (3) scanned pages — physically impossible to be lossless; verbatim-transcribe + confidence + never-guess policy (unchanged). |
| Q6/Q11 | Quota becomes env-configurable `QUOTA_DAILY_LIMIT` (default 50), backend upload limiter retuned to match (60/15min). Mechanism preserved as BYOK Gemini spend + load guard. |
| Q7/Q10 | Monitoring: scrape + alert. Telegram + email. Deferred until user provides materials (bot token, chat ID, email address) — see ticket 08. |
| Q8 | Legal/privacy: user confirmed no restriction on Gemini for these documents. |
| Q13 | Secrets: platform env vars + one offline escrowed copy of `LLM_CONFIG_ENCRYPTION_KEY` (password manager) — losing it = all BYOK keys unrecoverable. |
| Q14/Q17 | Password reset stays disabled; user accepted the consequence; admin-reset script added anyway per Q17 "yea" to defuse the account-loss contradiction. |
| Q20 | User already owns a domain hosted on Cloudflare — one zone, app + api hostnames. |

## Non-goals

- Serverless/object-storage refactor of the conversion service (revisit >100 users).
- Email-based self-service password reset (revisit when pilot widens).
- On-call rotation; alerts go to a channel the pilot owner reads.
- Multi-region / multi-VM scale-out.

## Constraints

- Free tiers only: Oracle Always Free (4 OCPU / 24GB ARM), GCS 5GB free, Cloudflare Pages free. Zero recurring cash cost; the domain already exists.
- No changes to the auth model (Bearer-token proxy stays; no direct browser→backend uploads).
- TDD: every ticket starts from a failing test (Rule 2).

## Tickets

`.scratch/production-readiness/issues/01..08` — quota env-var, backup+drill,
admin reset, TCVN3/VNI decode, fidelity ledger, VM deployment composition,
Cloudflare Pages frontend, cutover gate + monitoring hookup.
