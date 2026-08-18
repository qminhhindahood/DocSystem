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


def _texts(lines: list[Any]) -> list[str]:
    """Lines -> cleaned texts, preserving reading order (top-to-bottom)."""
    ordered = sorted(lines, key=_top)
    return [_clean(l.text) for l in ordered if l.text.strip()]


def build_admin_header(
    header_lines: list[Any], page: int, width: float,
) -> Optional[AdminHeaderBlock]:
    """Convert header-zone lines into an AdminHeaderBlock (content-first)."""
    if not header_lines:
        return None

    left = AdminHeaderLeft()
    right = AdminHeaderRight()
    unassigned: list[str] = []

    for t in _texts(header_lines):
        if _COUNTRY_RE.search(t) and not right.country_name:
            right.country_name = t
        elif _MOTTO_RE.search(t) and not right.motto:
            right.motto = t
        elif _DATE_RE.search(t) and not right.location_and_date:
            right.location_and_date = t
        elif _DOCNUM_RE.search(t) and not left.document_number:
            left.document_number = t
        else:
            unassigned.append(t)

    # Remaining short lines are the agency stack (superior above issuing).
    if len(unassigned) >= 2:
        left.superior_agency = unassigned[0]
        left.issuing_agency = unassigned[1]
    elif len(unassigned) == 1:
        left.issuing_agency = unassigned[0]

    has_content = any([
        right.country_name, right.motto, right.location_and_date,
        left.superior_agency, left.issuing_agency, left.document_number,
    ])
    if not has_content:
        return None

    return AdminHeaderBlock(left=left, right=right, confidence=0.85, page=page)


def _split_left_right(lines: list[Any], width: float) -> tuple[list[str], list[str]]:
    """Split zone lines into left/right column texts by line midpoint.

    Decree-30 closing zones are side-by-side: Nơi nhận on the left, the
    signature stack on the right. Lines whose midpoint sits in the right half
    (including centered signature lines) belong to the right column.
    """
    left: list[tuple[float, str]] = []
    right: list[tuple[float, str]] = []
    for l in lines:
        t = _clean(l.text)
        if not t:
            continue
        x0 = getattr(l, "x0", 0.0)
        top = _top(l)
        # Classify by the line's LEFT edge: the Nơi nhận column starts near
        # the left margin (x0 < 40% of page width); signature lines are
        # centered/right, so their x0 sits past 40% even when short.
        (left if x0 < width * 0.40 else right).append((top, t))
    left.sort(key=lambda p: p[0])
    right.sort(key=lambda p: p[0])
    return [t for _, t in left], [t for _, t in right]


def build_signature(
    sig_lines: list[Any], page: int, width: float,
) -> Optional[SignatureBlock]:
    """Convert signature-zone lines into a SignatureBlock.

    Spatial split first (Nơi nhận left / chữ ký right), then content matching
    inside each column so the signatory's name never leaks into the receipt
    list and vice versa.
    """
    if not sig_lines:
        return None

    left_texts, right_texts = _split_left_right(sig_lines, width)

    # ── left column: receipt list (drop the "Nơi nhận:" label) ──
    receipt = [t for t in left_texts if not _RECEIPT_LABEL_RE.match(t)]

    # ── right column: authority / title / name ──
    right = SignatureRight()
    leftover: list[str] = []
    for t in right_texts:
        if _AUTHORITY_RE.match(t) and not right.authority:
            right.authority = t
        elif _TITLE_RE.match(t) and not right.title:
            right.title = t
        else:
            leftover.append(t)
    # A short leftover line is most likely the signatory's name.
    for t in leftover:
        if len(t) < 40:
            right.name = t
            break

    has_content = bool(receipt) or any([
        right.authority, right.title, right.name,
    ])
    if not has_content:
        return None

    return SignatureBlock(
        left=SignatureLeft(receipt_list=receipt),
        right=right,
        confidence=0.85,
        page=page,
    )
