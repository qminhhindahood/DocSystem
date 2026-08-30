# Product Context

## Product

DocAI is a focused PDF-to-DOCX conversion service for Vietnamese administrative
documents.

## Users

Vietnamese professionals who hold administrative PDFs (decisions, official
letters, reports, notices) and need them re-emitted as DOCX files that comply
with Decree 30/2020/NĐ-CP typography — without reformatting by hand and without
handing the document to a general-purpose chatbot.

## Product Purpose

One job, done honestly: upload a PDF, receive a Decree-30-compliant DOCX.
Success means the conversion preserves the source content faithfully, applies
the official typography by rule (never by an LLM's judgment), reports its own
confidence and coverage so the user knows what to spot-check, refunds quota
when the infrastructure fails, and keeps every job visible only to its owner.

## Brand Personality

Precise, calm, trustworthy. The interface communicates conversion status
honestly — queued, processing, completed, completed with warnings, failed —
and keeps the document task, not infrastructure, at the center.

## Anti-references

- No document generation, no chat QA, no RAG, no template management, no
  dashboards, no admin consoles — those master-stack surfaces are deleted and
  their absence is contract-tested.
- No decorative AI theatrics; the LLM never decides formatting values.
- No claims that output is Microsoft-Word-identical; confidence and coverage
  are shown instead, and warnings never hide a structurally valid file.
- No silent drops: a scanned page that cannot be converted is reported as
  degraded, never skipped quietly.
- No server-held vision keys: scanned-page transcription is BYOK. Users bring
  their own Google Gemini key in the settings dialog; without one, a scanned
  upload is rejected up front with clear Vietnamese instructions instead of
  silently degrading, and it costs no quota.

## Design Principles

- Keep the user's PDF and the next action primary.
- Explain confidence, coverage, and degraded pages in plain Vietnamese.
- Preserve user control: warnings inform; the converted file stays downloadable.
- Treat privacy and owner scope as visible product behavior — a job id is
  never enough to read someone else's document.
- Failures cost nothing: invalid uploads, rejected scanned uploads, and failed
  conversions never consume the daily quota.
- Keys belong to their owner: a user's API key is stored encrypted for that
  account alone, is never echoed back, and never appears in logs or reports.

## Accessibility & Inclusion

Target WCAG 2.1 AA. Status must never rely on color alone; keyboard focus,
semantic announcements, readable contrast, reduced motion, and clear Vietnamese
labels are required.
