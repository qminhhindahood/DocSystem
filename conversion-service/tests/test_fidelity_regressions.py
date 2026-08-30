import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from assembly.stitcher import merge_split_tables, strip_running_headers
from pipeline import restore_unconsumed_zones
from schema.blocks import ParagraphBlock, TableBlock, TableCell
from structuring.admin_zones import build_admin_header, build_signature
from structuring.classifier import Classifier, LineInfo
from structuring.zones import partition_zones


def line(
    text: str,
    *,
    page: int = 1,
    x0: float = 72,
    y: float = 100,
    x1: float = 500,
    y1: float | None = None,
) -> LineInfo:
    return LineInfo(
        text=text,
        page=page,
        x0=x0,
        y=y,
        x1=x1,
        y1=y1 or y + 16,
        page_width=600,
        page_height=800,
    )


def paragraph(text: str, page: int, bbox: list[int]) -> ParagraphBlock:
    return ParagraphBlock(text=text, page=page, bbox=bbox, confidence=1.0)


def table(
    *,
    page: int,
    bbox: list[int] | None,
    headers: list[str] | None = None,
    rows: list[list[str]] | None = None,
) -> TableBlock:
    return TableBlock(
        page=page,
        bbox=bbox,
        headers=[
            [TableCell(text=value) for value in headers]
        ] if headers else [],
        rows=[
            [TableCell(text=value) for value in row]
            for row in (rows or [[str(page), "value"]])
        ],
        confidence=0.9,
    )


def test_page_two_top_and_unrecognized_bottom_return_to_body():
    lines = [
        line("Điều 2. Hiệu lực", page=2, y=80),
        line("Nội dung giữa trang.", page=2, y=350),
        line("Ghi chú cuối trang không phải chữ ký.", page=2, y=730),
    ]
    zones = partition_zones(lines, 2, 600, 800)
    signature = build_signature(zones.signature, 2, 600)

    restored = restore_unconsumed_zones(zones, None, signature)

    assert [item.text for item in restored] == [
        "Điều 2. Hiệu lực",
        "Nội dung giữa trang.",
        "Ghi chú cuối trang không phải chữ ký.",
    ]
    assert signature.block is None


def test_recognized_page_one_header_consumes_only_header_fields():
    lines = [
        line("BỘ TƯ PHÁP", y=40),
        line("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", x0=300, y=40),
        line("Độc lập - Tự do - Hạnh phúc", x0=320, y=65),
        line("Số: 12/QĐ-BTP", y=90),
        line("Dòng nội dung ở vùng trên phải được giữ lại.", y=180),
        line("Nội dung chính.", y=350),
    ]
    zones = partition_zones(lines, 1, 600, 800)
    header = build_admin_header(zones.header, 1, 600)

    restored = restore_unconsumed_zones(zones, header, None)

    assert header.block is not None
    assert "Dòng nội dung ở vùng trên phải được giữ lại." in [item.text for item in restored]
    assert "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM" not in [item.text for item in restored]


def test_signature_consumes_only_recognized_columns():
    lines = [
        line("Đoạn kết luận vẫn là nội dung.", y=660, x0=72, x1=300),
        line("BỘ TRƯỞNG", y=670, x0=380, x1=520),
        line("Nguyễn Văn A", y=730, x0=390, x1=510),
    ]
    zones = partition_zones(lines, 1, 600, 800)
    signature = build_signature(zones.signature, 1, 600)

    restored = restore_unconsumed_zones(zones, None, signature)

    assert signature.block is not None
    assert [item.text for item in restored] == ["Đoạn kết luận vẫn là nội dung."]


def test_classifier_emits_normalized_geometry():
    block = Classifier().structure([
        line("Một đoạn nội dung đủ dài để phân loại.", x0=60, y=320, x1=540, y1=352)
    ])[0]

    assert block.bbox == [100, 400, 900, 440]


def test_repeated_body_clause_is_preserved():
    blocks = [
        paragraph("Điều khoản chung", 1, [100, 420, 900, 470]),
        paragraph("Điều khoản chung", 2, [100, 420, 900, 470]),
    ]

    assert strip_running_headers(blocks) == blocks


def test_true_top_running_header_is_removed():
    blocks = [
        paragraph("CÔNG BÁO", 1, [100, 20, 900, 70]),
        paragraph("CÔNG BÁO", 2, [100, 18, 900, 68]),
    ]

    assert strip_running_headers(blocks) == []


def test_page_number_requires_margin_geometry():
    bottom_number = paragraph("5", 5, [480, 920, 520, 950])
    body_number = paragraph("5", 5, [480, 420, 520, 450])

    assert strip_running_headers([bottom_number, body_number]) == [body_number]


def test_true_table_continuation_merges_with_matching_header():
    first = table(page=1, bbox=[50, 700, 950, 940], headers=["Mã", "Tên"])
    second = table(page=2, bbox=[50, 30, 950, 260], headers=[" mã ", "TÊN"])

    merged = merge_split_tables([first, second])

    assert len(merged) == 1
    assert len(merged[0].rows) == 2


def test_independent_same_width_tables_do_not_merge():
    first = table(page=1, bbox=[50, 200, 950, 600], headers=["Mã", "Tên"])
    second = table(page=2, bbox=[50, 250, 950, 650], headers=["Mã", "Tên"])

    assert merge_split_tables([first, second]) == [first, second]


def test_mismatched_headers_or_missing_geometry_do_not_merge():
    mismatched_first = table(page=1, bbox=[50, 700, 950, 940], headers=["Mã", "Tên"])
    mismatched_second = table(page=2, bbox=[50, 30, 950, 260], headers=["Mã", "Địa chỉ"])
    no_geometry_first = table(page=1, bbox=None, headers=["Mã", "Tên"])
    no_geometry_second = table(page=2, bbox=None, headers=None)

    assert merge_split_tables([mismatched_first, mismatched_second]) == [mismatched_first, mismatched_second]
    assert merge_split_tables([no_geometry_first, no_geometry_second]) == [no_geometry_first, no_geometry_second]
