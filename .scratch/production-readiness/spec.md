# Spec: Production Readiness — Conversion Service (Pilot)

Outcome of the 2026-08-29 grill session ("is my project production ready?").
Goal: deploy the standalone PDF→DOCX conversion service for a 3–10 user pilot
on a free-tier hybrid platform with proven backup, configurable quota,
lossless Vietnamese legacy decoding, and the repo's own cutover gate walked
on the real host.

## Settled decisions (grill rounds 1–5)

| # | Decision |
|---|----------|
| Q1/Q15/Q19/Q22/Q36 | Hybrid platform: one Oracle **Always Free-only** A1 ARM VM at exactly 2 OCPU / 12 GB runs the whole stateful compose stack (postgres, redis, backend, conversion, conversion-worker); frontend on Cloudflare Workers Free via OpenNext. Build-on-VM deploys use the exact `main` commit. Pay As You Go is unavailable, and the GCP free `e2-micro` is too small for this stack. If A1 capacity is unavailable or the VM is reclaimed, deployment waits or the owner separately approves a paid GCP e2-medium-class fallback. |
| Q2/Q12/Q20 | Unannounced public soft launch: registration is technically open behind Turnstile from first deployment, but the URL is not advertised for the first 48 hours. The original expected cohort remains 3–10 users, but registration is not invite-limited. |
| Q3/Q21/Q25/Q26 | Data loss unacceptable → nightly Postgres `pg_dump`, client-side encrypted with `age`, then stored on VM disk and synced to GCS (30-day retention) + monthly restore drill. The recovery key is held only in the owner's password manager. Uploads/work volumes are not backed up (user-held, re-derivable). Accepted RPO is 24 hours; RTO is 8 waking-hours with no overnight response guarantee. |
| Q4 | Cutover gate is a hard requirement: `eval/preflight.py` PASS + `CUTOVER_CHECKLIST.md` walked on the production host + one real PDF→DOCX verified by a human. |
| Q5/Q16 | Lossless Vietnamese = three-tier definition: (1) digital PDFs — verbatim char extraction (CER<2% gate + new per-job fidelity ledger); (2) TCVN3/VNI legacy fonts — decode via mapping tables, CER=0 on fixtures, OCR only as fallback; (3) scanned pages — physically impossible to be lossless; verbatim-transcribe + confidence + never-guess policy (unchanged). |
| Q6/Q11 | Quota becomes env-configurable `QUOTA_DAILY_LIMIT` (default 50), backend upload limiter retuned to match (60/15min). Mechanism preserved as BYOK Gemini spend + load guard. |
| Q7/Q10/Q28/Q32 | Monitoring uses existing provider accounts instead of UptimeRobot/Grafana: GCP public uptime checks for the frontend and API, plus OCI custom metrics and email alarms for queue depth, disk use, backup age, and container health. The owner supplies and verifies one real alert destination during deployment. |
| Q8 | Legal/privacy: user confirmed no restriction on Gemini for these documents. |
| Q13 | Secrets: platform env vars + one offline escrowed copy of `LLM_CONFIG_ENCRYPTION_KEY` (password manager) — losing it = all BYOK keys unrecoverable. |
| Q14/Q17 | Password reset stays disabled; user accepted the consequence; admin-reset script added anyway per Q17 "yea" to defuse the account-loss contradiction. |
| Q20 | User already owns a domain hosted on Cloudflare — one zone, app + api hostnames. |
| Q10/Q21 | Cloudflare Workers Free is the production frontend tier. Paid upgrade is not pre-authorized. |
| Q14/Q22 | Add an operator CLI for account moderation and reject new conversion submissions temporarily when the global Redis queue reaches 100 pending jobs. |
| Q3/Q13/Q15 | Public registration is enabled behind Turnstile. Email ownership is not verified, password recovery remains disabled, and there is no global account-count ceiling; these are explicit pilot risk acceptances. The UI must warn users that lost passwords require operator assistance, and the operator CLI is the containment path for abusive accounts. |
| Q30 | A failed deployment health gate may automatically roll application code and containers back to the previous known-good version. Database restore, volume deletion, paid scaling, and production-secret rotation always require direct operator approval. |
| Q27/Q33 | Provide both authenticated self-service account deletion and operator-assisted deletion. Deletion revokes sessions and cascades through stored BYOK configuration; policies disclose that encrypted backup copies expire within 30 days. |
| Q29/Q34 | Public policy identity: DocAI, Vietnam, effective on the deployment date. `support@<domain>` must be a working Cloudflare Email Routing alias to the owner's verified private inbox; unresolved domain/contact values block public deployment. |
| Q19/Q24/Q35 | `main` is the only production source. Green pull-request CI precedes merge; Cloudflare deploys the frontend from `main`; OCI deploys the exact `main` commit only after manual operator approval. Failed application health gates trigger automatic application rollback. |
| Q23/Q31 | Conversion status polling uses a fixed five-second interval. This reduces Cloudflare Worker and backend requests by roughly 70% versus the previous 1.5-second interval while keeping the maximum normal UI completion-display delay to about five seconds; it does not change conversion execution time. |

## Non-goals

- Serverless/object-storage refactor of the conversion service (revisit >100 users).
- Email-based self-service password reset (revisit when pilot widens).
- On-call rotation; alerts go to a channel the pilot owner reads.
- Multi-region / multi-VM scale-out.

## Constraints

- Free-only allowances: Oracle Always Free A1 at exactly 2 OCPU / 12 GB in the tenancy home region, a GCS free-tier bucket in an eligible US region, and Cloudflare Workers Free. Target recurring cash cost is zero. Paid OCI capacity is impossible on the current account, and no paid GCP or Cloudflare resource may be created without explicit approval.
- OCI A1 capacity and continuity are not guaranteed. `out of host capacity` blocks cutover, and Oracle may reclaim an idle Always Free instance. The VM is therefore replaceable infrastructure; nightly encrypted off-provider backups and the documented rebuild path are launch requirements.
- No changes to the auth model (Bearer-token proxy stays; no direct browser→backend uploads).
- TDD: every ticket starts from a failing test (Rule 2).

## Tickets

`.scratch/production-readiness/issues/01..08` — quota env-var, backup+drill,
admin reset, TCVN3/VNI decode, fidelity ledger, VM deployment composition,
Cloudflare Worker frontend, cutover gate + monitoring hookup.
