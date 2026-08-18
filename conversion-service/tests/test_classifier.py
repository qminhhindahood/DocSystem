"""tests/test_classifier.py — 4-stage cascade + hierarchy state machine (plan §5)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from structuring.classifier import (
    Classifier,
    HierarchyState,
    LineInfo,
    classify_pattern,
    compute_baseline,
)


def L(text, **kw):
    return LineInfo(text=text, **kw)


def test_article_pattern():
    c = classify_pattern(L("Điều 1. Phạm vi điều chỉnh"))
    assert c is not None and c.kind == "article" and c.number == 1


def test_chapter_pattern():
    c = classify_pattern(L("CHƯƠNG II. QUY ĐỊNH CỤ THỂ"))
    assert c is not None and c.kind == "chapter"


def test_point_pattern():
    c = classify_pattern(L("a) Điểm thứ nhất"))
    assert c is not None and c.kind == "point" and c.marker == "a)"


def test_baseline_median():
    lines = [L("x" * 30, size=14)] * 5 + [L("y" * 30, size=12)]
    assert compute_baseline(lines) == 14


def test_article_sequence_enforced():
    clf = Classifier()
    lines = [
        L("Điều 1. Một", size=14, bold=True),
        L("Điều 3. Ba", size=14, bold=True),  # out of sequence -> demote
    ]
    blocks = clf.structure(lines)
    # first is a heading, second demoted to paragraph with low confidence
    assert blocks[0].type == "heading"
    assert blocks[1].type == "paragraph"
    assert blocks[1].confidence == 0.6
    assert clf.hier.demotions == 1


def test_clause_restarts_per_article():
    clf = Classifier()
    lines = [
        L("Điều 1. Một"),
        L("1. Khoản một"),
        L("2. Khoản hai"),
        L("Điều 2. Hai"),
        L("1. Khoản một của điều hai"),  # restarts at 1
    ]
    blocks = clf.structure(lines)
    assert clf.hier.article == 2
    assert clf.hier.demotions == 0


def test_point_sequence():
    clf = Classifier()
    lines = [
        L("Điều 1. Một"),
        L("1. Khoản"),
        L("a) điểm a"),
        L("b) điểm b"),
    ]
    blocks = clf.structure(lines)
    # points collapse into a single list block
    list_blocks = [b for b in blocks if b.type == "list"]
    assert len(list_blocks) == 1
    assert len(list_blocks[0].items) == 2


def test_point_out_of_sequence_demoted():
    clf = Classifier()
    lines = [
        L("Điều 1. Một"),
        L("1. Khoản"),
        L("c) điểm c nhảy cóc"),  # expected a)
    ]
    clf.structure(lines)
    assert clf.hier.demotions == 1
