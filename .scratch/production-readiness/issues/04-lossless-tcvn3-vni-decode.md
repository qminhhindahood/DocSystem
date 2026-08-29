# 04 — Lossless TCVN3/VNI decode (legacy Vietnamese fonts)

Status: open
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
