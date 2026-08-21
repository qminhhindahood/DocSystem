# 05 — Preserve source page order in mixed PDFs

**What to build:** Assemble digitally extracted and vision-transcribed content in the same page order as the source PDF, while preserving the original block order within each page.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Interleaved scanned and digital pages are emitted in ascending source-page order.
- [ ] Multiple blocks from one page retain their extraction order when pages are merged.
- [ ] Regression coverage includes scanned page 1 with digital page 2 and a longer alternating mixed document.
