"""tests/test_rule_engine.py — Decree 30 rule engine (plan §8)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config
from rules.rule_engine import RuleEngine
from schema.blocks import ParagraphBlock


def make_engine():
    return RuleEngine(config.SHARED_TYPOGRAPHY_PATH)


def test_loads_shared_typography():
    e = make_engine()
    assert e.font_family == "Times New Roman"
    assert e.first_line_indent_pt == 36


def test_derive_runs_legal_basis_italic():
    e = make_engine()
    runs = e.derive_runs("Căn cứ Nghị định số 30/2020/NĐ-CP ngày 05 tháng 3 năm 2020;")
    assert runs and runs[0].italic is True


def test_derive_runs_law_name_italic():
    e = make_engine()
    runs = e.derive_runs("Thực hiện Luật Tổ chức Chính phủ năm 2015.")
    italics = [r for r in runs if r.italic]
    assert italics, "law name should be italic"


def test_apply_sets_first_line_indent_on_justify():
    e = make_engine()
    p = ParagraphBlock(text="Nội dung đoạn văn.", align="justify", confidence=1.0)
    e.apply([p])
    assert p.first_line_indent_pt == 36
    assert p.runs  # runs derived


def test_apply_no_indent_on_centered():
    e = make_engine()
    p = ParagraphBlock(text="Tiêu đề giữa trang", align="center", confidence=1.0)
    e.apply([p])
    assert p.first_line_indent_pt is None
