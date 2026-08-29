# 08 — Cutover gate on production + monitoring hookup

Status: open
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
