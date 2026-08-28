"""structuring/classifier.py — 4-stage text structuring engine (plan §5).

Stage 1: baseline — median body font size from paragraph-like lines.
Stage 2: pattern-first classification (regex on normalized text).
Stage 3: typographic tie-break (centered+bold+uppercase short line = title;
         size > baseline & bold = heading; indent+justify = body paragraph).
Stage 4: hierarchy state machine — validates numbering continuity and
         demotes violations to paragraph with lowered confidence.

This is a specified four-stage pipeline, not "some regex".
"""
from __future__ import annotations

import re
import statistics
from dataclasses import dataclass, field
from typing import Optional

from schema.blocks import (
    HeadingBlock,
    ListBlock,
    ListItem,
    ParagraphBlock,
)

# ─── Stage 2 patterns (plan §5 table) ─────────────────────────────────────────

ROMAN = r"[IVXLC]+"
PATTERNS: list[tuple[str, re.Pattern]] = [
    ("article", re.compile(r"^(?:ĐIỀU|Điều)\s+(\d+)", re.UNICODE)),
    ("chapter", re.compile(r"^(?:CHƯƠNG|Chương)\s+(" + ROMAN + r"|\d+)", re.UNICODE)),
    ("section", re.compile(r"^(?:MỤC|Mục)\s+(\d+)", re.UNICODE)),
    ("part", re.compile(r"^(?:PHẦN|Phần)\s+(" + ROMAN + r")", re.UNICODE)),
    ("clause", re.compile(r"^(\d+)\.\s")),
    ("point", re.compile(r"^([a-z])\)\s|^\-([a-z]?)\)\s")),
    ("preamble_kw", re.compile(
        r"^(?:CĂN CỨ|Căn cứ|XÉT|Xét|THEO ĐỀ NGHỊ|Theo đề nghị)", re.UNICODE)),
    ("operative_kw", re.compile(
        r"^(?:QUYẾT ĐỊNH:|NAY |ĐIỀU \d+\.)", re.UNICODE)),
    ("closing_kw", re.compile(r"^(?:Nơi nhận|TM\.|KT\.)", re.UNICODE)),
    ("annex", re.compile(r"^(?:PHỤ LỤC|Phụ lục)(?:\s+(" + ROMAN + r"|\d+))?", re.UNICODE)),
]


@dataclass
class LineInfo:
    """One logical line with typographic metadata."""
    text: str
    size: float = 14.0
    bold: bool = False
    italic: bool = False
    centered: bool = False
    indented: bool = False
    page: int = 1
    y: float = 0.0
    y1: float = 0.0
    x0: float = 0.0
    x1: float = 0.0
    page_width: float = 0.0
    page_height: float = 0.0

    @property
    def cy(self) -> float:
        return (self.y + self.y1) / 2 if self.y1 else self.y


@dataclass
class Classified:
    line: LineInfo
    kind: str = "paragraph"      # article/chapter/section/part/clause/point/title/paragraph/list_item/preamble/operative/closing/annex
    number: Optional[int] = None
    roman: Optional[str] = None
    marker: Optional[str] = None
    stage: int = 3               # which stage decided (2=pattern, 3=typo)
    confidence: float = 1.0


# ─── Stage 0: wrapped-line merge (intra-page paragraph reassembly) ────────────
#
# PyMuPDF reports each VISUAL line separately; a justified paragraph wrapped
# over 3 lines arrives as 3 LineInfo objects. Classifying them independently
# produces 3 one-line paragraphs (and any naive concatenation loses the space
# at the wrap point). We merge continuation lines back into their paragraph
# BEFORE classification, joining with a single space.

_TERMINAL_END = (".", ":", ";", "!", "?", "\"", "\"")


def _is_structural_start(line: LineInfo) -> bool:
    """True when a line looks like the START of a new logical unit and must
    never be swallowed as a continuation of the previous line."""
    if classify_pattern(line) is not None:
        return True
    text = line.text.strip()
    is_upper = text == text.upper() and any(ch.isalpha() for ch in text)
    # centered + bold short line = title/heading candidate (stage 3). We accept
    # any case because Decree-30 titles often have a mixed-case second line
    # ("QUYẾT ĐỊNH" / "Về việc ...").
    if line.centered and line.bold and len(text) < 60:
        return True
    if line.centered and is_upper and len(text) < 60:
        return True
    return False


def merge_wrapped_lines(lines: list[LineInfo]) -> list[LineInfo]:
    """Join visual lines that are continuations of the previous paragraph.

    A line merges into its predecessor when ALL hold:
    - same page;
    - the predecessor does not end in terminal punctuation (. : ; ! ?);
    - the current line is not a structural start (numbering pattern or
      centered-bold-uppercase title);
    - similar font size (within 1.5 pt — same paragraph run);
    - small vertical gap (< 1.6x the predecessor line height — no blank
      line between them).

    The merge inserts a single space, fixing the wrap-point space loss.
    """
    out: list[LineInfo] = []
    last_h: list[float] = []  # height of the last PHYSICAL line per merged group
    for line in lines:
        line_h = max(line.y1 - line.y, 1.0)
        if out:
            prev = out[-1]
            prev_text = prev.text.rstrip()
            # Gap threshold uses the height of the most recent physical line,
            # NOT the accumulated paragraph span (which would balloon and let
            # everything merge).
            height = last_h[-1]
            gap = line.y - prev.y1
            same_page = prev.page == line.page
            open_end = bool(prev_text) and not prev_text.endswith(_TERMINAL_END)
            similar_size = abs(line.size - prev.size) <= 1.5
            close = gap < 1.6 * height
            # A centered title/heading never absorbs a non-centered body line
            # (and vice versa) — that is a block boundary, not a wrap.
            same_align = prev.centered == line.centered
            if (same_page and open_end and close and similar_size and same_align
                    and not _is_structural_start(line)):
                prev.text = f"{prev_text} {line.text.strip()}"
                prev.y1 = line.y1
                prev.x1 = max(prev.x1, line.x1)
                # keep the paragraph's boldest/largest styling hint
                prev.bold = prev.bold or line.bold
                prev.size = max(prev.size, line.size)
                last_h[-1] = line_h  # next gap measured against THIS line
                continue
        out.append(line)
        last_h.append(line_h)
    return out


# ─── Stage 1: baseline ────────────────────────────────────────────────────────

def compute_baseline(lines: list[LineInfo]) -> float:
    """Median body font size from paragraph-like lines."""
    sizes = [l.size for l in lines if len(l.text.strip()) >= 20]
    if not sizes:
        sizes = [l.size for l in lines] or [14.0]
    return statistics.median(sizes)


# ─── Stage 2: pattern-first ───────────────────────────────────────────────────

def classify_pattern(line: LineInfo) -> Optional[Classified]:
    text = line.text.strip()
    for name, pat in PATTERNS:
        m = pat.match(text)
        if not m:
            continue
        c = Classified(line=line, kind=name, stage=2, confidence=1.0)
        g = m.group(1) if m.groups() else None
        if name in ("article", "section", "clause") and g and g.isdigit():
            c.number = int(g)
        elif name in ("chapter", "part", "annex") and g:
            c.roman = g if not g.isdigit() else None
            c.number = int(g) if g.isdigit() else None
        elif name == "point" and g:
            c.marker = f"{g})"
        return c
    return None


# ─── Stage 3: typographic tie-break ───────────────────────────────────────────

def classify_typography(line: LineInfo, baseline: float) -> Classified:
    text = line.text.strip()
    is_upper = text == text.upper() and any(ch.isalpha() for ch in text)
    short = len(text) < 60
    no_terminal = not text.endswith((".", ":", ";", ",", "!", "?"))

    # Centered + bold + uppercase + short -> document title
    if line.centered and line.bold and is_upper and short and no_terminal:
        return Classified(line=line, kind="title", stage=3, confidence=0.8)
    # Font size > baseline AND bold -> heading
    if line.size > baseline and line.bold:
        return Classified(line=line, kind="heading", stage=3, confidence=0.8)
    # First-line indent + justified -> body paragraph
    return Classified(line=line, kind="paragraph", stage=3, confidence=0.8)


# ─── Stage 4: hierarchy state machine ─────────────────────────────────────────

STATES = ("FRONT_MATTER", "PREAMBLE", "BODY", "CLOSING")


@dataclass
class HierarchyState:
    state: str = "FRONT_MATTER"
    chapter: Optional[str] = None
    article: int = 0
    clause: int = 0
    point: str = ""
    demotions: int = 0
    total: int = 0

    def reset_clause(self) -> None:
        self.clause = 0
        self.point = ""

    def reset_point(self) -> None:
        self.point = ""


def _next_letter(cur: str) -> str:
    return chr(ord(cur) + 1) if cur else "a"


class Classifier:
    """Runs the 4-stage cascade over a page's lines and emits schema blocks."""

    def __init__(self) -> None:
        self.hier = HierarchyState()

    def structure(self, lines: list[LineInfo]) -> list:
        lines = merge_wrapped_lines(lines)
        baseline = compute_baseline(lines)
        blocks: list = []
        pending_points: list[Classified] = []

        def flush_points() -> None:
            if pending_points:
                items = [ListItem(text=p.line.text.strip()) for p in pending_points]
                marker = pending_points[0].marker or "a)"
                blocks.append(ListBlock(
                    ordered=True, marker=marker, items=items,
                    confidence=min(p.confidence for p in pending_points),
                    page=pending_points[0].line.page,
                    bbox=_union_bbox([p.line for p in pending_points]),
                ))
                pending_points.clear()

        for line in lines:
            c = classify_pattern(line) or classify_typography(line, baseline)
            c = self._state_machine(c)
            self.hier.total += 1
            block = self._to_block(c)
            if block is None:  # point -> accumulate into list
                pending_points.append(c)
                continue
            flush_points()
            if block is not None:
                blocks.append(block)
        flush_points()
        return blocks

    def _state_machine(self, c: Classified) -> Classified:
        """Validate transitions + numbering continuity; demote on violation."""
        h = self.hier
        kind = c.kind

        if kind == "preamble_kw":
            h.state = "PREAMBLE"
            return c
        if kind == "closing_kw":
            h.state = "CLOSING"
            return c
        if kind == "chapter":
            h.state = "BODY"
            h.chapter = c.roman or str(c.number)
            h.article = 0
            h.reset_clause()
            return c
        if kind == "article":
            h.state = "BODY"
            expected = h.article + 1
            if c.number != expected:
                return self._demote(c, f"Điều {c.number} out of sequence (expected {expected})")
            h.article = c.number
            h.reset_clause()
            return c
        if kind == "clause":
            if h.state != "BODY" or h.article == 0:
                # 1. in a preamble table is a list item, not a Khoản
                if h.state == "PREAMBLE":
                    c.kind = "list_item"
                    return c
                return self._demote(c, "clause outside an Điều")
            expected = h.clause + 1
            if c.number != expected:
                return self._demote(c, f"Khoản {c.number} out of sequence (expected {expected})")
            h.clause = c.number
            h.reset_point()
            return c
        if kind == "point":
            if h.state != "BODY" or h.clause == 0:
                c.kind = "list_item"
                return c
            expected = _next_letter(h.point)
            got = (c.marker or "a)")[0]
            if got != expected:
                return self._demote(c, f"Điểm '{got})' out of sequence (expected {expected})")
            h.point = got
            return c
        if kind == "title":
            h.state = "FRONT_MATTER"
            return c
        return c

    def _demote(self, c: Classified, reason: str) -> Classified:
        """Demote to paragraph + lower confidence (never silently mislabel)."""
        c.kind = "paragraph"
        c.confidence = 0.6
        c.stage = 4
        self.hier.demotions += 1
        c.line.text = c.line.text  # keep original text
        return c

    def _to_block(self, c: Classified):
        """Map a classified line to a schema block (None = accumulate point)."""
        text = c.line.text.strip()
        page = c.line.page
        conf = c.confidence
        bbox = _line_bbox(c.line)

        if c.kind == "point":
            return None  # accumulated into a ListBlock
        if c.kind in ("title",):
            return HeadingBlock(level=1, text=text, align="center",
                                confidence=conf, page=page, bbox=bbox)
        if c.kind in ("article", "chapter", "section", "part", "heading", "annex"):
            level = {"article": 2, "chapter": 3, "section": 3,
                     "part": 3, "heading": 2, "annex": 2}[c.kind]
            align = "center" if c.kind in ("chapter", "annex", "part") else "left"
            return HeadingBlock(level=level, text=text, align=align,
                                confidence=conf, page=page, bbox=bbox)
        if c.kind in ("clause", "list_item"):
            return ParagraphBlock(text=text, align="justify",
                                  confidence=conf, page=page, bbox=bbox)
        if c.kind in ("preamble_kw", "operative_kw"):
            return ParagraphBlock(text=text, align="justify",
                                  confidence=conf, page=page, bbox=bbox)
        if c.kind == "closing_kw":
            return ParagraphBlock(text=text, align="left",
                                  confidence=conf, page=page, bbox=bbox)
        # paragraph
        return ParagraphBlock(text=text, align="justify",
                              confidence=conf, page=page, bbox=bbox)


def _line_bbox(line: LineInfo) -> Optional[list[int]]:
    if (
        line.page_width <= 0
        or line.page_height <= 0
        or line.x1 <= line.x0
        or line.y1 <= line.y
    ):
        return None
    x0 = max(0, min(999, round(1000 * line.x0 / line.page_width)))
    y0 = max(0, min(999, round(1000 * line.y / line.page_height)))
    x1 = max(x0 + 1, min(1000, round(1000 * line.x1 / line.page_width)))
    y1 = max(y0 + 1, min(1000, round(1000 * line.y1 / line.page_height)))
    return [x0, y0, x1, y1]


def _union_bbox(lines: list[LineInfo]) -> Optional[list[int]]:
    boxes = [box for line in lines if (box := _line_bbox(line)) is not None]
    if not boxes:
        return None
    return [
        min(box[0] for box in boxes),
        min(box[1] for box in boxes),
        max(box[2] for box in boxes),
        max(box[3] for box in boxes),
    ]
