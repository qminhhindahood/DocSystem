# 05 — Per-job fidelity ledger (digital-path verbatim guarantee)

Status: resolved
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

## Implementation answers (2026-01 session)

- **Metric design (probe-driven)**: an ordered CER ledger false-alarms on
  perfectly verbatim documents — the QD fixture (all 570 chars preserved)
  scores 0.69 ordered-CER purely from block reordering (header/signature
  grouping) and the Decree-30 uppercase transform ("Điều 1." -> "ĐIỀU 1.").
  The honest tier-1 metric is BAG (multiset) fidelity on case-folded,
  whitespace-collapsed text: immune to reordering + documented uppercase,
  exact on every other character. Verified: QD fixture reports 1.0 / 0.0.
- **Normalization is stated, never silent**: the payload carries the
  normalization list ("casefold", "whitespace-collapse", "bag-order-free")
  so the number is never misread as a strict byte compare.
- **CER definition**: bag divergence rate — (missing + extra) / max(len);
  a substitution counts 2 units, so the ledger is never optimistic.
- **Scanned jobs**: ledger is explicitly None — no fake fidelity number
  against text that doesn't exist in the source. Report shows confidence.
- **Drift hook**: fidelity < 0.99 (FIDELITY_DRIFT_THRESHOLD) increments the
  existing failure counters in BOTH paths — worker (queue mode) and main's
  sync path — so the existing high_failure_rate alert catches silent drift;
  the user-facing job status degrades to completed_with_warnings with a
  Vietnamese warning + capped divergence spans for review.
- **Surfacing**: ConversionReport.fidelity_ledger flows through asdict()
  to the job store and /convert/{id}/report as fidelityLedger.
- **Layout deviation (accepted)**: one fidelity.py module (not
  structuring/) — the ledger compares pipeline-extracted text vs saved DOCX,
  which is a pipeline-level concern, not structuring.
- **Tests**: 15 new (11 unit incl. span caps + normalization honesty, 2
  pipeline integration, 2 HTTP endpoint). Suite: 202 passed.
