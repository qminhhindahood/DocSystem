# CONTEXT — Conversion Service (Standalone)

Glossary of domain terms. Implementation-free: no file paths, no config keys, no architecture.

## Terms

**Conversion Job** — one PDF→DOCX unit of work, identified by a `jobId`. Lifecycle: `queued → processing → completed | completed_with_warnings | failed`. A job always belongs to exactly one user.

**Confidence** — document-level score for a completed conversion, in [0, 1]. It is *capped by Coverage*: emitting 40% of the source text can never score 1.0. It never defaults to 1.0 — an empty or partial output says so.

**Coverage** — ratio of content characters emitted to text-layer characters extracted. The honesty input to Confidence.

**Degraded Page** — a scanned page that could not be converted (vision not configured). Degraded pages are reported, never silently dropped; enough of them fail the whole job.

**Quota** — per-user daily cap on conversions (default 50). Charged only after the PDF passes validation, so garbage uploads are free. A conversion that later fails should not consume quota (refund).

**Typography Contract** — the single canonical source of Decree 30/2020 styling values (sizes, margins, zones, roles). Humans curate it; the rule engine applies it; no LLM ever decides a value in it.

**Admin Header** — the mandatory Decree-30 top zone: superior/issuing agency, document number, country name, motto, location and date.

**Signature Block** — the mandatory Decree-30 bottom zone: receipt list (Nơi nhận) and signatory. A multi-page document signs once, on the last page that carries the zone.

**Page Triage** — per-page classification into DIGITAL_TEXT, SCANNED, or TABLE_HEAVY, deciding which extraction path runs. ⚠️ Not the same word as *issue triage* (the tracker role vocabulary) — in this project, unqualified "triage" means page triage only inside the conversion pipeline.

**Removed Surfaces** — master-stack capabilities (RAG, generation workflow, QA, templates, feedback/LoRA, admin) that this fork has deleted. Their absence is asserted by contract tests, not assumed.

**Standalone Stack** — this product's own compose project, images, volumes, and secrets; it must never read or write the master stack's.
