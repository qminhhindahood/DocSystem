"""structuring/admin_zones.py — serialize header/signature zones to schema blocks.

The pipeline partitions each page into header (top ~25%), body, and signature
(bottom ~25%) zones. Previously only the body was structured; header and
signature zones were silently discarded, losing the Quốc hiệu, tiêu ngữ,
tiêu đề, Nơi nhận, and chữ ký — all mandatory Decree-30 components.

This module converts those zones into AdminHeaderBlock / SignatureBlock so the
renderer (which already supports both) can emit them.

Detection is CONTENT-FIRST: each Decree-30 header/signature field has a
distinctive textual signature (Quốc hiệu starts "CỘNG HÒA", motto starts
"Độc lập", date matches "ngày ... tháng ... năm ...", etc.), so we match by
content rather than by fragile 2-column spatial clustering. Spatial order is
used only to keep multi-line values in reading order.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from schema.blocks import (
    AdminHeaderBlock,
    AdminHeaderLeft,
    AdminHeaderRight,
    SignatureBlock,
    SignatureLeft,
    SignatureRight,
)
from typing import Any


@dataclass(frozen=True)
class ZoneBuildResult:
    block: Optional[AdminHeaderBlock | SignatureBlock]
    consumed_line_ids: frozenset[int] = frozenset()

# ─── field detection patterns ─────────────────────────────────────────────────

_COUNTRY_RE = re.compile(r"CỘNG\s+H[OÒ]A", re.UNICODE | re.IGNORECASE)
_MOTTO_RE = re.compile(r"Độc\s+lập", re.UNICODE | re.IGNORECASE)
_DOCNUM_RE = re.compile(r"^S[ốô]\s*:", re.UNICODE | re.IGNORECASE)
_DATE_RE = re.compile(
    r"\d{1,2}\s+th[áa]ng\s+\d{1,2}\s+năm\s+\d{4}", re.UNICODE
)
_AUTHORITY_RE = re.compile(r"^(?:TM\.|KT\.)\s", re.UNICODE)
_TITLE_RE = re.compile(
    r"^(?:BỘ\s+TRƯỞNG|THỨ\s+TRƯỞNG|CHỦ\s+TỊCH|PHÓ\s+CHỦ\s+TỊCH|"
    r"GIÁM\s+ĐỐC|PHÓ\s+GIÁM\s+ĐỐC|TỔNG\s+GIÁM\s+ĐỐC|CỤC\s+TRƯỞNG|"
    r"PHÓ\s+CỤC\s+TRƯỞNG|VỤ\s+TRƯỞNG|TRƯỞNG\s+BAN|HIỆU\s+TRƯỞNG|"
    r"CHÁNH\s+VĂN\s+PHÒNG|GIÁM\s+ĐỐC\s+SỞ)",
    re.UNICODE,
)
_RECEIPT_LABEL_RE = re.compile(r"^Nơi\s+nhận", re.UNICODE | re.IGNORECASE)
_RECEIPT_ITEM_RE = re.compile(r"^[\-•]\s", re.UNICODE)


def _clean(text: str) -> str:
    return " ".join(text.split())


def _top(l: Any) -> float:
    """Top coordinate, tolerant of LineInfo (.y) and TextLine (.y0)."""
    return getattr(l, "y", None) if getattr(l, "y", None) is not None else getattr(l, "y0", 0.0)


def _ordered_lines(lines: list[Any]) -> list[tuple[Any, str]]:
    """Lines with cleaned text, preserving top-to-bottom reading order."""
    ordered = sorted(lines, key=lambda item: (_top(item), getattr(item, "x0", 0.0)))
    return [(item, _clean(item.text)) for item in ordered if item.text.strip()]


def _looks_like_agency(text: str) -> bool:
    letters = [char for char in text if char.isalpha()]
    return bool(letters) and len(text) <= 80 and text == text.upper()


def build_admin_header(
    header_lines: list[Any], page: int, width: float,
) -> ZoneBuildResult:
    """Convert header-zone lines into an AdminHeaderBlock (content-first)."""
    if not header_lines:
        return ZoneBuildResult(block=None)

    left = AdminHeaderLeft()
    right = AdminHeaderRight()
    unassigned: list[tuple[Any, str]] = []
    consumed: set[int] = set()

    for source, t in _ordered_lines(header_lines):
        if _COUNTRY_RE.search(t) and not right.country_name:
            right.country_name = t
            consumed.add(id(source))
        elif _MOTTO_RE.search(t) and not right.motto:
            right.motto = t
            consumed.add(id(source))
        elif _DATE_RE.search(t) and not right.location_and_date:
            right.location_and_date = t
            consumed.add(id(source))
        elif _DOCNUM_RE.search(t) and not left.document_number:
            left.document_number = t
            consumed.add(id(source))
        else:
            unassigned.append((source, t))

    recognized = bool(
        (right.country_name and right.motto)
        or (left.document_number and (
            right.country_name or right.motto or right.location_and_date
        ))
    )
    if not recognized:
        return ZoneBuildResult(block=None)

    # Remaining short lines are the agency stack (superior above issuing).
    agencies = [(source, text) for source, text in unassigned if _looks_like_agency(text)][:2]
    if len(agencies) >= 2:
        left.superior_agency = agencies[0][1]
        left.issuing_agency = agencies[1][1]
    elif len(agencies) == 1:
        left.issuing_agency = agencies[0][1]
    consumed.update(id(source) for source, _text in agencies)

    block = AdminHeaderBlock(left=left, right=right, confidence=0.85, page=page)
    return ZoneBuildResult(block=block, consumed_line_ids=frozenset(consumed))


def _split_left_right(lines: list[Any], width: float) -> tuple[list[tuple[Any, str]], list[tuple[Any, str]]]:
    """Split zone lines into left/right column texts by line midpoint.

    Decree-30 closing zones are side-by-side: Nơi nhận on the left, the
    signature stack on the right. Lines whose midpoint sits in the right half
    (including centered signature lines) belong to the right column.
    """
    left: list[tuple[float, Any, str]] = []
    right: list[tuple[float, Any, str]] = []
    for l in lines:
        t = _clean(l.text)
        if not t:
            continue
        x0 = getattr(l, "x0", 0.0)
        top = _top(l)
        # Classify by the line's LEFT edge: the Nơi nhận column starts near
        # the left margin (x0 < 40% of page width); signature lines are
        # centered/right, so their x0 sits past 40% even when short.
        (left if x0 < width * 0.40 else right).append((top, l, t))
    left.sort(key=lambda p: p[0])
    right.sort(key=lambda p: p[0])
    return [(line, text) for _, line, text in left], [(line, text) for _, line, text in right]


def build_signature(
    sig_lines: list[Any], page: int, width: float,
) -> ZoneBuildResult:
    """Convert signature-zone lines into a SignatureBlock.

    Spatial split first (Nơi nhận left / chữ ký right), then content matching
    inside each column so the signatory's name never leaks into the receipt
    list and vice versa.
    """
    if not sig_lines:
        return ZoneBuildResult(block=None)

    left_lines, right_lines = _split_left_right(sig_lines, width)
    consumed: set[int] = set()

    # ── left column: receipt list (drop the "Nơi nhận:" label) ──
    has_receipt_label = any(_RECEIPT_LABEL_RE.match(text) for _line, text in left_lines)
    receipt = [
        text for _line, text in left_lines
        if has_receipt_label and not _RECEIPT_LABEL_RE.match(text)
    ]
    if has_receipt_label:
        consumed.update(id(source) for source, _text in left_lines)

    # ── right column: authority / title / name ──
    right = SignatureRight()
    leftover: list[tuple[Any, str]] = []
    has_signature_cue = False
    for source, t in right_lines:
        if _AUTHORITY_RE.match(t) and not right.authority:
            right.authority = t
            has_signature_cue = True
            consumed.add(id(source))
        elif _TITLE_RE.match(t) and not right.title:
            right.title = t
            has_signature_cue = True
            consumed.add(id(source))
        else:
            leftover.append((source, t))
    # A short leftover line is most likely the signatory's name.
    for source, t in leftover:
        if has_signature_cue and len(t) < 40:
            right.name = t
            consumed.add(id(source))
            break

    if not has_receipt_label and not has_signature_cue:
        return ZoneBuildResult(block=None)

    block = SignatureBlock(
        left=SignatureLeft(receipt_list=receipt),
        right=right,
        confidence=0.85,
        page=page,
    )
    return ZoneBuildResult(block=block, consumed_line_ids=frozenset(consumed))
