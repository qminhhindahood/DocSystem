# 05 — Per-job fidelity ledger (digital-path verbatim guarantee)

Status: open
Blocked by: (none)

## Why

Q12/Q16 tier 1: every extracted character must land verbatim in the DOCX.
Today quality is gate-checked (CER < 2% digital) but the user sees no per-job
proof. A per-job ledger comparing extracted chars vs DOCX chars surfaces
any deviation in the reliability report (`/convert/:id/report`).

## Scope

- `conversion-service/structuring/` or `pipeline.py`: after DOCX assembly,
  compute a fidelity ledger — normalized (whitespace-collapsed) extracted
  text vs normalized DOCX text: char counts, CER, and a list of divergence
  spans (first N, capped).
- Persist into the job record (Redis job store payload) and surface in the
  report payload the backend already forwards (`/convert/{job_id}/report`).
- Digital + LEGACY_TEXT pages: fidelity must be 1.0/CER 0 modulo documented
  normalization; scanned pages: report OCR confidence instead (unchanged).
- Alerting hook: fidelity < 0.99 on a digital job increments the existing
  failure metrics counter so the existing alert rule catches silent drift.

## Acceptance

- [ ] Unit test: synthetic digital job → ledger reports fidelity 1.0, CER 0.
- [ ] Unit test: deliberately altered char → ledger flags the divergence
      span and drops fidelity below 1.0.
- [ ] Report endpoint test: ledger fields present in the report payload.
- [ ] Scanned job: report shows confidence, not a fake fidelity number.
- [ ] Conversion suite green.
