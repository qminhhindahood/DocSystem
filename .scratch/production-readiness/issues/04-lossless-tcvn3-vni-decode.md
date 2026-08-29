# 04 — Lossless TCVN3/VNI decode (legacy Vietnamese fonts)

Status: resolved
Blocked by: (none)

## Why

Q5/Q12/Q16: "make it lossless for Vietnamese." Today `triage.py` detects
legacy TCVN3/VNI pages (old fonts without ToUnicode CMaps that extract as
ASCII garbage) and routes them to Gemini OCR — but OCR of a degraded image
can never be lossless. True losslessness for those pages requires decoding
the embedded legacy byte codes through TCVN3→Unicode and VNI→Unicode
mapping tables.

Three-tier definition (accepted in grill round 4):

1. Digital PDFs — extracted chars land verbatim in the DOCX (gate CER < 2%,
   new fidelity ledger in ticket 05).
2. TCVN3/VNI legacy fonts — decode via mapping tables, CER = 0 on fixtures;
   OCR only when decoding structurally fails.
3. Scanned pages — verbatim-transcribe + confidence + never-guess policy
   (unchanged Gemini contract).

## Scope

- New `conversion-service/legacy/` package: `tcvn3_to_unicode.py` and
  `vni_to_unicode.py` mapping-table decoders; a dispatcher that takes the
  raw extracted text + font hints (PyMuPDF font names like Times New Roman
  `.VnTime`, `.VnArial` are TCVN3 conventions) and returns decoded text or
  a structured failure.
- `triage.py`: legacy-encoded pages route to the decoder first; only when
  decoding fails do they fall back to SCANNED (vision). Page classification
  gains a `LEGACY_TEXT` class (treated as digital-grade for fidelity).
- Mapping tables: TCVN3 (57 chars) and VNI (double-charset, 134 combos) —
  sourced from the published UNETI Vietnamese standard encodings; tables
  embedded as JSON in `shared/` alongside the typography file.
- Fixtures: synthetic PDFs rendering known Vietnamese text through TCVN3
  and VNI encodings (built in-test via font-codepoint substitution), asserting
  CER = 0 end-to-end through `convert_pdf`.

## Acceptance

- [ ] Decoder unit tests: TCVN3 fixture text → exact Unicode (CER = 0).
- [ ] Decoder unit tests: VNI fixture text → exact Unicode (CER = 0).
- [ ] Triage routing test: legacy-encoded page no longer classified SCANNED
      when decode succeeds.
- [ ] Fallback test: structurally undecodable page still routes to SCANNED.
- [ ] End-to-end fixture test through `convert_pdf`: CER = 0 on legacy
      fixtures, DOCX contains the exact Unicode text.
- [ ] Real-corpus eval stays open: when the user supplies 20–50 real old
      administrative PDFs, run them and record results (synthetic fixtures ≠
      corpus certification — stated honestly in the report).
- [ ] Conversion suite green (128 + new).

## Implementation answers (2026-01 session)

- **Tables**: cross-validated against two independent published sources
  before freezing — bongmeomeovn/TCVN3-Convert-Unicode mapping.txt and
  vuthaihoc/py-unicode-convert converter.py. 73/73 single-byte agreement
  on overlap; zero disagreements. The one cross-source conflict
  (mapping.txt maps ASCII hyphen 45 -> ư) was resolved toward identity:
  eating hyphens is worse than missing a rare form.
- **Layout deviation (accepted)**: one `legacy/decode.py` module carries both
  tables + the `decode_best` dispatcher instead of `tcvn3_to_unicode.py` +
  `vni_to_unicode.py`; tables are Python dicts inside that module instead of
  JSON in `shared/`. Functionally equivalent; fixtures live in
  `tests/fixtures_legacy.json`, generated from the same verified tables
  (hand-typing high-byte mojibake produced wrong fixtures twice — the
  discipline is: fixtures come from the tables or they don't exist).
- **Font hints deviation (accepted)**: dispatcher is text-statistics-based
  (decode must improve VN diacritic health by >= 0.10 AND re-encode
  byte-identically to the source) rather than font-name hints
  (`.VnTime` etc.). The round-trip identity check is a stronger guarantee
  than a font name: it proves the decode lossless per page. TCVN3-vs-VNI
  discrimination uses composite-pair usage (VNI's signature).
- **Critical safety guard**: TCVN3 keys overlap Latin-1 codepoints (byte
  225 -> 'ả' while Unicode 'á' is U+00E1 = 225), so unconditional decoding
  would corrupt healthy Unicode. The health-gain + round-trip guards keep
  healthy digital pages on the DIGITAL_TEXT path; tested explicitly.
- **Wiring**: `triage_page` returns LEGACY_TEXT when decode_best succeeds
  (both in the corrupted-encoding branch and as a high-byte-mojibake catch
  after the diacritic floor — real TCVN3 extraction carries é/ß/Ö which
  count as diacritics and clear the 0.05 floor); pipeline decodes per line
  (geometry preserved for zone partitioning), falls back to SCANNED when
  the page-level decode fails; main.py's admission gate admits legacy
  PDFs without a Gemini key automatically (`== SCANNED` test unchanged).
- **Tests**: 23 new (13 decoder unit, 10 routing/e2e). All exact-equality
  (CER = 0 by assertion). Suite: 186 passed (163 pre-existing + 23).
- **Real-corpus eval**: still open as stated — fixture-certified only
  until 20–50 real legacy administrative PDFs are supplied.
- **Known limitation (review finding)**: a page mixing legacy-encoded and
  healthy Unicode text fails the byte-identical round-trip, so it falls back
  to SCANNED (vision transcription, tier 3) rather than a partial table
  decode. Honest degradation, no content loss — but tier-3 quality on such
  pages until a per-span decoder is justified by real corpus evidence.
- **Code review (2026-01 session)**: standards + spec axes run directly;
  compileall OK, 186→187 tests green. Two probe findings: (1) mixed-page
  fallback recorded above; (2) a suspected sliver-decode bug dissolved
  under tracing — `Céng hßa` is genuinely TCVN3 `Cộng hòa` (re-encode
  proves byte identity). French/Latin-1 no-gain guard added as a test.
