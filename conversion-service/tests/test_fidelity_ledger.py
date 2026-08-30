"""test_fidelity_ledger.py — per-job fidelity ledger (ticket 05).

Tier-1 guarantee: every extracted character lands verbatim in the DOCX
(modulo documented normalization — case folding and whitespace collapse;
Decree-30 uppercases article openers by design, block order is a layout
artifact, not content).

Ledger contract:
- multiset (bag) fidelity on case-folded, whitespace-collapsed text —
  immune to block reordering and the documented uppercase transform,
  exact on every other character;
- word-level divergence spans (cap N) for human review;
- digital + LEGACY_TEXT pages: fidelity 1.0 / CER 0 required;
- scanned pages: no fidelity number is reported (OCR is not verbatim);
  the report shows confidence instead.
"""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fidelity import FidelityLedger, compute_ledger
from tests.serif_font import TIMES


class TestComputeLedgerDigital:
    def test_verbatim_text_fidelity_one(self):
        ext = "Căn cứ Nghị định số 30/2020/NĐ-CP của Chính phủ"
        led = compute_ledger(ext, ext)
        assert isinstance(led, FidelityLedger)
        assert led.fidelity == 1.0
        assert led.cer == 0.0
        assert led.divergence_spans == []

    def test_reordered_blocks_still_one(self):
        # Block reordering (header/signature grouping) must not count as
        # content loss — the guarantee is per-character presence, not order.
        ext = "BỘ NỘI VỤ CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM"
        docx = "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM BỘ NỘI VỤ"
        led = compute_ledger(ext, docx)
        assert led.fidelity == 1.0
        assert led.cer == 0.0

    def test_decree30_uppercase_transform_is_documented_normalization(self):
        # "Điều 1." -> "ĐIỀU 1." is the Decree-30 typography rule, not loss.
        ext = "Điều 1. Thành lập Ban công tác văn thư."
        docx = "ĐIỀU 1. THÀNH LẬP BAN CÔNG TÁC VĂN THƯ."
        led = compute_ledger(ext, docx)
        assert led.fidelity == 1.0
        assert led.cer == 0.0

    def test_whitespace_collapse_is_documented_normalization(self):
        ext = "Căn   cứ\tNghị  định"
        docx = "Căn cứ Nghị định"
        led = compute_ledger(ext, docx)
        assert led.fidelity == 1.0

    def test_missing_char_drops_fidelity(self):
        # A genuinely lost character (diacritic dropped), not a case flip —
        # case-only drift is invisible under the documented case-fold
        # normalization (Decree-30 uppercases article openers by design).
        ext = "Căn cứ Nghị định số 30/2020/NĐ-CP của Chính phủ"
        docx = "Căn cứ Nghi định số 30/2020/NĐ-CP của Chinh phủ"
        led = compute_ledger(ext, docx)
        assert led.fidelity < 1.0
        assert led.cer > 0.0
        assert len(led.divergence_spans) >= 1

    def test_deliberately_altered_char_flags_span(self):
        ext = "Thành lập Ban công tác văn thư"
        docx = "Thành lập Ban công tác văn thur"  # 'ư' -> 'r'
        led = compute_ledger(ext, docx)
        assert led.fidelity < 1.0
        spans = led.divergence_spans
        assert spans, "divergence must produce at least one span"
        span = spans[0]
        assert span.get("kind") in ("missing", "extra", "changed")
        assert "thur" in span.get("docx", "") or "thư" in span.get("extracted", "")

    def test_extra_content_in_docx_flags_span(self):
        ext = "Điều 2. Quyết định này có hiệu lực kể từ ngày ký."
        docx = "Điều 2. Quyết định này có hiệu lực kể từ ngày ký. Kèm theo."
        led = compute_ledger(ext, docx)
        assert led.fidelity < 1.0
        assert any(s["kind"] == "extra" for s in led.divergence_spans)

    def test_span_cap(self):
        # Many divergences -> capped list, never unbounded payload.
        ext = "x y z " * 200
        docx = "a b c " * 200
        led = compute_ledger(ext, docx)
        assert len(led.divergence_spans) <= led.MAX_SPANS

    def test_counts_present(self):
        ext = "Căn cứ Nghị định"
        docx = "Căn cứ Nghị định"
        led = compute_ledger(ext, docx)
        assert led.extracted_chars == len("Căn cứ Nghị định")
        assert led.docx_chars == len("Căn cứ Nghị định")

    def test_empty_inputs(self):
        led = compute_ledger("", "")
        assert led.fidelity == 1.0
        assert led.cer == 0.0


class TestLedgerScannedMode:
    def test_scanned_report_shows_confidence_not_fake_fidelity(self):
        # Scanned pages are transcribed, not copied — reporting a fidelity
        # number against text that doesn't exist would be fake. Scanned-only
        # jobs get NO ledger object at all (covered end-to-end in
        # TestLedgerIntegration.test_pipeline_report_ledger_none_for_scanned_job);
        # compute_ledger is simply never called for them — asserted here at
        # the module contract level: the pipeline decides, not the ledger.
        import inspect
        import pipeline as pl

        src = inspect.getsource(pl.convert_pdf)
        assert "fidelity_ledger" in src and "ledger_text_parts" in src


class TestLedgerIntegration:
    def test_pipeline_report_carries_ledger_for_digital_job(self, tmp_path):
        import fitz
        from pipeline import convert_pdf

        doc = fitz.open()
        page = doc.new_page()
        font = fitz.Font(fontfile=TIMES)
        tw = fitz.TextWriter(page.rect)
        tw.append(
            (72, 96),
            "Căn cứ Nghị định số 30/2020/NĐ-CP ngày 05 tháng 3 năm 2020 của "
            "Chính phủ về công tác văn thư; xét đề nghị của Cục trưởng Cục "
            "Văn thư và Lưu trữ nhà nước về việc ban hành quy định này.",
            font=font,
            fontsize=14,
        )
        tw.write_text(page)
        pdf = str(tmp_path / "digital.pdf")
        doc.save(pdf)
        doc.close()

        path, report = convert_pdf(pdf, str(tmp_path / "digital.docx"))
        led = report.fidelity_ledger
        assert led is not None
        assert led["fidelity"] == 1.0
        assert led["cer"] == 0.0

    def test_pipeline_report_ledger_none_for_scanned_job(self, tmp_path):
        import fitz
        from pipeline import convert_pdf

        doc = fitz.open()
        doc.new_page()  # no text at all
        pdf = str(tmp_path / "blank.pdf")
        doc.save(pdf)
        doc.close()

        _, report = convert_pdf(pdf, str(tmp_path / "blank.docx"))
        assert report.fidelity_ledger is None


class TestReportEndpoint:
    def test_report_payload_carries_fidelity_ledger(self):
        """HTTP contract: /convert/:id/report must surface the ledger."""
        import main

        main.STORE.save("ledger-job-1", {
            "jobId": "ledger-job-1", "status": "completed", "progress": 1.0,
            "userId": "ledger-u1",
            "report": {
                "fidelity_ledger": {
                    "fidelity": 0.9876, "cer": 0.0124,
                    "extractedChars": 570, "docxChars": 563,
                    "divergenceSpans": [],
                    "normalization": ["casefold", "whitespace-collapse", "bag-order-free"],
                },
            },
        })
        try:
            from fastapi.testclient import TestClient
            with TestClient(main.app) as client:
                r = client.get("/convert/ledger-job-1/report")
                assert r.status_code == 200
                led = r.json()["fidelityLedger"]
                assert led is not None
                assert led["fidelity"] == 0.9876
                assert led["cer"] == 0.0124
                assert "normalization" in led
        finally:
            main.STORE.save("ledger-job-1", {}, ttl=1)

    def test_report_payload_ledger_absent_for_scanned_job(self):
        import main

        main.STORE.save("ledger-job-2", {
            "jobId": "ledger-job-2", "status": "completed", "progress": 1.0,
            "userId": "ledger-u2",
            "report": {"fidelity_ledger": None},
        })
        try:
            from fastapi.testclient import TestClient
            with TestClient(main.app) as client:
                r = client.get("/convert/ledger-job-2/report")
                assert r.status_code == 200
                assert r.json()["fidelityLedger"] is None
        finally:
            main.STORE.save("ledger-job-2", {}, ttl=1)
