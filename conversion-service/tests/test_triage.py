"""tests/test_triage.py — multi-signal triage helpers (plan §4)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from triage.triage import (
    DIGITAL_TEXT,
    SCANNED,
    TABLE_HEAVY,
    is_corrupted_encoding_or_bad_ocr,
    triage_page,
)


class FakeRect:
    def __init__(self, w, h):
        self.width = w
        self.height = h


class FakeTables:
    def __init__(self, n):
        self.tables = [object()] * n


class FakePage:
    def __init__(self, text="", images=None, image_rects=None, tables=0, w=595, h=842):
        self._text = text
        self._images = images or []
        self._image_rects = image_rects or {}
        self._tables = tables
        self.rect = FakeRect(w, h)

    def get_text(self):
        return self._text

    def get_images(self, full=True):
        return self._images

    def get_image_rects(self, xref):
        return self._image_rects.get(xref, [])

    def find_tables(self):
        return FakeTables(self._tables)


VN_TEXT = (
    "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM Độc lập Tự do Hạnh phúc. "
    "Căn cứ Nghị định số 30/2020/NĐ-CP ngày 05 tháng 3 năm 2020 của Chính phủ "
    "về công tác văn thư; xét đề nghị của Cục trưởng Cục Văn thư và Lưu trữ nhà nước."
)


def test_no_text_is_scanned():
    assert triage_page(FakePage(text="")) == SCANNED


def test_clean_vietnamese_is_digital():
    assert triage_page(FakePage(text=VN_TEXT)) == DIGITAL_TEXT


def test_ascii_garbage_is_scanned():
    # Legacy TCVN3 without ToUnicode -> ASCII-only, near-zero diacritics
    garbage = "CNG HA X HI CH NGHA VIT NAM c lp T do Hnh phc " * 5
    assert triage_page(FakePage(text=garbage)) == SCANNED


def test_fullpage_image_with_sliver_is_scanned():
    page = FakePage(
        text="footer only",
        images=[(42, 0, 0, 0, 0, 0, 0)],
        image_rects={42: [FakeRect(590, 840)]},  # ~full page
    )
    assert triage_page(page) == SCANNED


def test_table_geometry_is_table_heavy():
    page = FakePage(text=VN_TEXT, tables=1)
    assert triage_page(page) == TABLE_HEAVY


def test_corrupted_encoding_detector():
    assert is_corrupted_encoding_or_bad_ocr("abc def") is True  # too few letters
    assert is_corrupted_encoding_or_bad_ocr(VN_TEXT) is False
    assert is_corrupted_encoding_or_bad_ocr("a" * 60) is True  # no diacritics
