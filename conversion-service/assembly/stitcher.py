"""assembly/stitcher.py — cross-page assembly (plan §7 stage 4).

- fill post-processing fields: infer anchor_block from bbox zone; on scanned
  pages crop the page pixmap at each image bbox and fill src
- merge split tables across consecutive pages where column counts match
- join dangling paragraphs/clauses cut by a page break (no terminal . : ;)
- strip repetitive running headers/footers and page numbers
- consolidate consecutive same-orientation pages into single sections
"""
from __future__ import annotations

import re
from typing import Any, Optional

import config
from schema.blocks import (
    Block,
    ImageBlock,
    ParagraphBlock,
    SectionBreakBlock,
    TableBlock,
)

TERMINAL_PUNCT = (".", ":", ";", "!", "?", '"', '"')
_PAGE_NUMBER_RE = re.compile(r"^\s*(?:trang|Trang)?\s*\d{1,3}\s*$")


# ─── anchor_block inference (post-processing, §6.1) ───────────────────────────

def infer_anchor_block(block: ImageBlock) -> Optional[str]:
    """Deterministically infer anchor_block from the bbox zone.

    A seal/stamp/signature bbox inside the signature zone (bottom-right) is
    anchored to the signature block. Everything else anchors to nothing
    (inline flow).
    """
    if block.kind not in ("seal", "stamp", "signature"):
        return None
    _, y0, _, y1 = block.bbox
    cy = (y0 + y1) / 2 / 1000.0  # normalized 0-1
    sig_top = 1.0 - config.SIGNATURE_ZONE_RATIO
    if cy >= sig_top:
        return "signature"
    return None


def fill_anchor_blocks(blocks: list[Block]) -> list[Block]:
    for b in blocks:
        if isinstance(b, ImageBlock) and b.anchor_block is None:
            b.anchor_block = infer_anchor_block(b)
    return blocks


# ─── src fill for scanned pages (crop page pixmap at bbox) ────────────────────

def fill_scanned_src(blocks: list[Block], doc, media_dir, page_index_map: dict[int, int]) -> list[Block]:
    """For scanned-path image blocks missing src, crop the page pixmap at the
    reported bbox and save to the media folder (plan §6.1).

    page_index_map: 1-based page number -> 0-based fitz page index.
    """
    from pathlib import Path

    media = Path(media_dir)
    media.mkdir(parents=True, exist_ok=True)
    for i, b in enumerate(blocks):
        if not isinstance(b, ImageBlock) or b.src:
            continue
        page_no = b.page
        if page_no is None or page_no not in page_index_map:
            continue
        try:
            page = doc[page_index_map[page_no]]
            rect = page.rect
            x0 = b.bbox[0] / 1000 * rect.width
            y0 = b.bbox[1] / 1000 * rect.height
            x1 = b.bbox[2] / 1000 * rect.width
            y1 = b.bbox[3] / 1000 * rect.height
            import fitz
            clip = fitz.Rect(x0, y0, x1, y1)
            pix = page.get_pixmap(clip=clip, dpi=200)
            out = media / f"p{page_no}_img{i}.png"
            pix.save(str(out))
            b.src = str(out)
        except Exception:
            continue
    return blocks


# ─── running header/footer strip ──────────────────────────────────────────────

def strip_running_headers(blocks: list[Block]) -> list[Block]:
    """Remove paragraph text repeated across >= 2 pages (running headers/
    footers) and bare page numbers."""
    # count identical paragraph texts across distinct pages
    seen: dict[str, set[int]] = {}
    for b in blocks:
        if isinstance(b, ParagraphBlock):
            t = (b.text or "").strip()
            if t:
                seen.setdefault(t, set()).add(b.page or 0)
    repeated = {t for t, pages in seen.items() if len(pages) >= 2}

    out: list[Block] = []
    for b in blocks:
        if isinstance(b, ParagraphBlock):
            t = (b.text or "").strip()
            if t in repeated or _PAGE_NUMBER_RE.match(t):
                continue
        out.append(b)
    return out


# ─── dangling clause join ─────────────────────────────────────────────────────

def join_dangling(blocks: list[Block]) -> list[Block]:
    """Join paragraphs cut by a page break: a paragraph not ending in
    terminal punctuation followed by a paragraph on the next page merges."""
    out: list[Block] = []
    for b in blocks:
        if (
            out
            and isinstance(b, ParagraphBlock)
            and isinstance(out[-1], ParagraphBlock)
            and (out[-1].page or 0) != (b.page or 0)
            and (b.page or 0) == (out[-1].page or 0) + 1
        ):
            prev = out[-1]
            prev_text = (prev.text or "").rstrip()
            if prev_text and not prev_text.endswith(TERMINAL_PUNCT):
                # merge: append current text onto previous
                cur_text = (b.text or "").strip()
                prev.text = f"{prev_text} {cur_text}".strip()
                prev.runs = []  # rule engine will re-derive
                prev.confidence = min(prev.confidence, b.confidence)
                continue
        out.append(b)
    return out


# ─── split table merge ────────────────────────────────────────────────────────

def _table_cols(t: TableBlock) -> int:
    rows = list(t.headers) + list(t.rows)
    if not rows:
        return 0
    return max(sum(c.colspan for c in row) for row in rows)


def merge_split_tables(blocks: list[Block]) -> list[Block]:
    """Merge tables split across consecutive pages when column counts match."""
    out: list[Block] = []
    for b in blocks:
        if (
            out
            and isinstance(b, TableBlock)
            and isinstance(out[-1], TableBlock)
            and (out[-1].page or 0) + 1 == (b.page or 0)
            and _table_cols(out[-1]) == _table_cols(b)
        ):
            prev = out[-1]
            # continuation: append rows (drop repeated header if identical)
            prev.rows.extend(b.rows)
            prev.confidence = min(prev.confidence, b.confidence)
            continue
        out.append(b)
    return out


# ─── section consolidation ────────────────────────────────────────────────────

def consolidate_sections(blocks: list[Block]) -> list[Block]:
    """Collapse consecutive same-orientation section_breaks into one."""
    out: list[Block] = []
    for b in blocks:
        if (
            isinstance(b, SectionBreakBlock)
            and out
            and isinstance(out[-1], SectionBreakBlock)
            and out[-1].orientation == b.orientation
        ):
            continue
        out.append(b)
    return out


# ─── top-level assembly ───────────────────────────────────────────────────────

def assemble(blocks: list[Block], doc=None, media_dir=None,
             page_index_map: Optional[dict[int, int]] = None) -> list[Block]:
    """Run the full assembly pipeline in order."""
    blocks = fill_anchor_blocks(blocks)
    if doc is not None and media_dir is not None and page_index_map is not None:
        blocks = fill_scanned_src(blocks, doc, media_dir, page_index_map)
    blocks = strip_running_headers(blocks)
    blocks = join_dangling(blocks)
    blocks = merge_split_tables(blocks)
    blocks = consolidate_sections(blocks)
    return blocks
