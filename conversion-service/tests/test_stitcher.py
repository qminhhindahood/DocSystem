"""tests/test_stitcher.py — cross-page assembly (plan §7 stage 4)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from assembly.stitcher import (
    assemble,
    infer_anchor_block,
    join_dangling,
    merge_split_tables,
    strip_running_headers,
)
from schema.blocks import (
    ImageBlock,
    ParagraphBlock,
    SectionBreakBlock,
    TableCell,
    TableBlock,
)


def test_anchor_inferred_in_signature_zone():
    seal = ImageBlock(kind="seal", bbox=[620, 780, 850, 980], confidence=0.85)
    assert infer_anchor_block(seal) == "signature"


def test_anchor_none_for_photo():
    photo = ImageBlock(kind="photo", bbox=[100, 100, 300, 300],
                       placement="inline", confidence=0.9)
    assert infer_anchor_block(photo) is None


def test_join_dangling_across_page_break():
    p1 = ParagraphBlock(text="Đây là nội dung bị cắt", confidence=1.0, page=1)
    p2 = ParagraphBlock(text="và tiếp tục ở trang sau.", confidence=1.0, page=2)
    out = join_dangling([p1, p2])
    assert len(out) == 1
    assert "bị cắt và tiếp tục" in out[0].text


def test_no_join_when_terminal_punct():
    p1 = ParagraphBlock(text="Kết thúc câu.", confidence=1.0, page=1)
    p2 = ParagraphBlock(text="Câu mới ở trang sau.", confidence=1.0, page=2)
    out = join_dangling([p1, p2])
    assert len(out) == 2


def test_strip_repeated_running_header():
    h1 = ParagraphBlock(text="BÁO CÁO ĐỊNH KỲ", confidence=1.0, page=1,
                        bbox=[100, 20, 900, 70])
    h2 = ParagraphBlock(text="BÁO CÁO ĐỊNH KỲ", confidence=1.0, page=2,
                        bbox=[100, 18, 900, 68])
    body = ParagraphBlock(text="Nội dung riêng.", confidence=1.0, page=1,
                          bbox=[100, 300, 900, 350])
    out = strip_running_headers([h1, body, h2])
    assert len(out) == 1
    assert out[0].text == "Nội dung riêng."


def test_strip_page_numbers():
    pn = ParagraphBlock(text="5", confidence=1.0, page=5,
                        bbox=[480, 920, 520, 950])
    out = strip_running_headers([pn])
    assert out == []


def test_merge_split_tables_same_columns():
    t1 = TableBlock(headers=[[TableCell(text="A"), TableCell(text="B")]],
                    rows=[[TableCell(text="1"), TableCell(text="2")]],
                    confidence=0.9, page=1, bbox=[50, 700, 950, 940])
    t2 = TableBlock(rows=[[TableCell(text="3"), TableCell(text="4")]],
                    confidence=0.9, page=2, bbox=[50, 30, 950, 260])
    out = merge_split_tables([t1, t2])
    assert len(out) == 1
    assert len(out[0].rows) == 2


def test_no_merge_different_columns():
    t1 = TableBlock(rows=[[TableCell(text="1"), TableCell(text="2")]],
                    confidence=0.9, page=1)
    t2 = TableBlock(rows=[[TableCell(text="x")]], confidence=0.9, page=2)
    out = merge_split_tables([t1, t2])
    assert len(out) == 2


def test_assemble_pipeline_runs():
    blocks = [
        ParagraphBlock(text="Mở đầu bị cắt", confidence=1.0, page=1),
        ParagraphBlock(text="và nối tiếp.", confidence=1.0, page=2),
        SectionBreakBlock(orientation="landscape", confidence=1.0, page=3),
        SectionBreakBlock(orientation="landscape", confidence=1.0, page=4),
    ]
    out = assemble(blocks)
    # dangling joined + duplicate section consolidated
    assert len(out) == 2


def test_assemble_orders_mixed_sources_by_page():
    blocks = [
        ParagraphBlock(text="Trang số hai.", confidence=1.0, page=2),
        ParagraphBlock(text="Trang quét số một.", confidence=1.0, page=1),
    ]

    out = assemble(blocks)

    assert [(block.page, block.text) for block in out] == [
        (1, "Trang quét số một."),
        (2, "Trang số hai."),
    ]


def test_assemble_keeps_same_page_order_in_alternating_document():
    blocks = [
        ParagraphBlock(text="Trang bốn.", confidence=1.0, page=4),
        ParagraphBlock(text="Trang hai.", confidence=1.0, page=2),
        ParagraphBlock(text="Trang một, khối A.", confidence=1.0, page=1),
        ParagraphBlock(text="Trang ba.", confidence=1.0, page=3),
        ParagraphBlock(text="Trang một, khối B.", confidence=1.0, page=1),
    ]

    out = assemble(blocks)

    assert [(block.page, block.text) for block in out] == [
        (1, "Trang một, khối A."),
        (1, "Trang một, khối B."),
        (2, "Trang hai."),
        (3, "Trang ba."),
        (4, "Trang bốn."),
    ]
