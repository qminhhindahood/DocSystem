# 08 — Cutover gate on production + monitoring hookup

Status: resolved
Blocked by: 01, 02, 03, 04, 05, 06, 07

## Why

Q4: the repo's own cutover gate is a hard requirement — preflight PASS +
checklist walked on the real host + a human-verified conversion. Q7/Q10/Q18:
monitoring wiring (Telegram + email) is deferred until the user provides
bot token, chat ID, and email address.

## Scope

- On the VM: run `python eval/preflight.py --url http://conversion:8004`
  (inside the compose network) → must print `PREFLIGHT: PASS`.
- Walk `CUTOVER_CHECKLIST.md` end-to-end on production: health/ready/metrics,
  smoke tests (protected PDF → 422, non-PDF → 400, bulk, quota 429 at the
  configured limit, DOCX opens in Word), admin reset exercised once.
- Human-verified real conversion: user uploads a real administrative PDF
  and confirms the DOCX.
- Monitoring materials checklist (user-provided, later): Telegram bot token,
  chat ID, alert email → wire UptimeRobot (3× /health) + Grafana Cloud free
  (`conversion_failure_rate > 0.2`, `conversion_queue_depth` growing >10min
  → Telegram + email). Until then: mark the two alert rules as runbook
  manual checks.

## Acceptance

- [ ] Preflight PASS output captured on the VM.
- [ ] Checklist walked with every box checked and dated.
- [ ] One real PDF→DOCX conversion verified by the human user.
- [ ] Admin reset exercised once on production (or a staging VM run).
- [ ] Monitoring: either wired (materials provided) or documented as the
      single remaining manual step with the exact setup commands ready.

## Implementation answers (2026-01 session)

- **Preflight**: PROVEN locally — `PREFLIGHT: PASS` (7/7 checks) run from
  the host repo clone against the live conversion container. Important
  operational discovery: the preflight script must run from the repo
  CLONE on the VM (not `docker exec`): the lean image ships no `eval/`,
  `scripts/`, or `shared/`, and check_typography_sync.py needs the repo
  layout (REPO_ROOT/conversion-service + REPO_ROOT/shared). The checklist
  and runbook document this. Quota check shows limit=50/day from the env
  var (ticket 01).
- **CUTOVER_CHECKLIST.md**: rewritten as the full hard gate — stack-up with
  prod overlay + Cloudflare checks, preflight output paste box, smoke
  battery through the production frontend (incl. >4.5MB upload proof,
  legacy-TCVN3 conversion, fidelity report), observability, backup +
  admin-reset exercises, human sign-off box with date, rollback, and the
  honest known-limitations section (fixture-certified tiers).
- **Monitoring**: runbook §8 now carries the exact ready-to-run setup —
  UptimeRobot 3× /health monitors, Grafana Cloud free tier with a VM
  Prometheus scraping conversion:8004/metrics, the two alert rules in
  PromQL (failure ratio >0.2 over last 50 jobs; queue depth growing >10
  min), Alertmanager → Telegram webhook + SMTP. Until the user provides
  bot token/chat ID/email, §8.4 documents the daily manual checks and
  the checklist marks them as the single remaining manual step.
- **Human steps that remain (by design, user-owned)**: walk the checklist
  on the real VM, the real-PDF sign-off, and supplying the monitoring
  materials. Everything automatable from the repo is done and locked by
  Pester (12 checks, CutoverGate.Tests.ps1).
- **Tests**: CutoverGate.Tests.ps1 12/12; ops suite grows to 76 (57 + 7
  CloudflarePages + 12 CutoverGate).
