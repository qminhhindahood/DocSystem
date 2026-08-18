"""structuring/zones.py — page geometry: zones, 2-column clustering, stamping.

Every Vietnamese administrative document opens and closes with side-by-side
2-column blocks (agency/number left, motto/date right; Nơi nhận left,
signature right). Naive top-to-bottom extraction interleaves these lines.
We extract via spatial bounding-box clustering (page.get_text("blocks")) and
detect left/right splits in the top ~25% and bottom ~25% of the page before
serializing into admin_header / signature schema nodes (plan §4, §5).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import config


@dataclass
class TextLine:
    """One spatial text block from page.get_text('blocks')."""
    x0: float
    y0: float
    x1: float
    y1: float
    text: str
    page: int

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2


@dataclass
class PageZones:
    """Zone partition of one page."""
    page: int
    width: float
    height: float
    header: list[TextLine] = field(default_factory=list)
    body: list[TextLine] = field(default_factory=list)
    signature: list[TextLine] = field(default_factory=list)


def extract_lines(page, page_number: int) -> list[TextLine]:
    """Spatial blocks -> TextLine list (drops image-only blocks)."""
    lines: list[TextLine] = []
    for b in page.get_text("blocks"):
        # blocks: (x0, y0, x1, y1, text, block_no, type); type 0 = text
        if len(b) >= 7 and b[6] != 0:
            continue
        text = (b[4] or "").strip()
        if not text:
            continue
        lines.append(TextLine(b[0], b[1], b[2], b[3], text, page_number))
    lines.sort(key=lambda l: (l.y0, l.x0))
    return lines


def partition_zones(lines: list[TextLine], page_number: int,
                    width: float, height: float) -> PageZones:
    """Split lines into header (top ~25%), body, signature (bottom ~25%)."""
    header_cut = height * config.HEADER_ZONE_RATIO
    sig_cut = height * (1.0 - config.SIGNATURE_ZONE_RATIO)
    pz = PageZones(page=page_number, width=width, height=height)
    for l in lines:
        if l.cy <= header_cut:
            pz.header.append(l)
        elif l.cy >= sig_cut:
            pz.signature.append(l)
        else:
            pz.body.append(l)
    return pz


def split_two_columns(lines: list[TextLine], width: float) -> tuple[list[TextLine], list[TextLine]]:
    """Cluster lines into left/right columns around the page midline.

    Returns (left_lines, right_lines), each sorted top-to-bottom. A line is
    'left' when its right edge stays left of the midline, 'right' when its
    left edge is right of the midline; wide lines spanning both go left
    (they belong to the dominant/first column).
    """
    mid = width / 2
    left: list[TextLine] = []
    right: list[TextLine] = []
    for l in lines:
        if l.x1 <= mid + 1:
            left.append(l)
        elif l.x0 >= mid - 1:
            right.append(l)
        else:
            left.append(l)  # spanning line -> left column
    left.sort(key=lambda l: (l.y0, l.x0))
    right.sort(key=lambda l: (l.y0, l.x0))
    return left, right


def is_two_column(lines: list[TextLine], width: float) -> bool:
    """True when a zone has a genuine left/right split (both sides populated)."""
    left, right = split_two_columns(lines, width)
    return bool(left) and bool(right)


def stamp_page(blocks: list[Any], page_number: int) -> list[Any]:
    """Stamp the 1-based page number on every block missing one (§5)."""
    for b in blocks:
        if getattr(b, "page", None) is None:
            b.page = page_number
    return blocks
