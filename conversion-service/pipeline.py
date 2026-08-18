"""pipeline.py — per-document conversion orchestration (plan §7).

Wires: Ingest -> Triage -> Extract/Structure -> Assembly -> Rule engine ->
Render -> Deliver. Text pages run free (classifier cascade); scanned pages
route to the Gemini vision contract; TABLE_HEAVY uses find_tables primary +
quality gate with Gemini region-vision fallback.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import config
from assembly.stitcher import assemble
from ingest.intake import check_password, open_document
from render.docx_builder import DocxBlockBuilder
from rules.rule_engine import RuleEngine
from schema.blocks import Block, blocks_to_dicts, parse_blocks
from schema.validator import validate_chunk
from structuring.classifier import Classifier, LineInfo
from structuring.zones import extract_lines, partition_zones
from triage.triage import DIGITAL_TEXT, SCANNED, TABLE_HEAVY, triage_page

logger = logging.getLogger(__name__)


@dataclass
class ConversionReport:
    status: str = "completed"          # completed | completed_with_warnings | failed
    pages: int = 0
    page_types: dict[str, int] = field(default_factory=dict)
    degraded_pages: list[int] = field(default_factory=list)
    confidence: float = 1.0
    timings: dict[str, float] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    # P4 confidence-flag review (plan §10 thresholds):
    flagged_blocks: list[dict] = field(default_factory=list)   # block < 0.6
    low_confidence_pages: list[dict] = field(default_factory=list)  # page avg < 0.7
    demotions: int = 0                                          # Stage-4 rate input


def _extract_text_page_lines(page, page_number: int) -> list[LineInfo]:
    """Build LineInfo list with typographic metadata from dict spans."""
    data = page.get_text("dict")
    page_w = page.rect.width
    lines: list[LineInfo] = []
    for blk in data.get("blocks", []):
        if blk.get("type") != 0:
            continue
        for ln in blk.get("lines", []):
            spans = ln.get("spans", [])
            if not spans:
                continue
            text = "".join(s.get("text", "") for s in spans).strip()
            if not text:
                continue
            bbox = ln.get("bbox", (0, 0, 0, 0))
            size = max((s.get("size", 14.0) for s in spans), default=14.0)
            flags = spans[0].get("flags", 0)
            bold = bool(flags & 2 ** 4)
            italic = bool(flags & 2 ** 1)
            x0, y0, x1, y1 = bbox
            cx = (x0 + x1) / 2
            centered = abs(cx - page_w / 2) < page_w * 0.08
            indented = x0 > page.rect.width * 0.12
            lines.append(LineInfo(
                text=text, size=size, bold=bold, italic=italic,
                centered=centered, indented=indented,
                page=page_number, y=y0, y1=y1,
            ))
    lines.sort(key=lambda l: l.y)
    return lines


def convert_pdf(pdf_path: str, out_path: str,
                media_dir: Optional[str] = None) -> tuple[str, ConversionReport]:
    """Convert one PDF to DOCX. Returns (docx_path, report)."""
    report = ConversionReport()
    t0 = time.time()

    # 1. Ingest — password rejection (Option A)
    check_password(pdf_path)
    doc = open_document(pdf_path)
    try:
        report.pages = len(doc)

        all_blocks: list[Block] = []
        page_index_map: dict[int, int] = {}
        classifier = Classifier()

        # 2. Triage + 3. Extract/Structure (per page)
        for idx in range(len(doc)):
            page = doc[idx]
            page_no = idx + 1
            page_index_map[page_no] = idx
            ptype = triage_page(page)
            report.page_types[ptype] = report.page_types.get(ptype, 0) + 1

            if ptype == DIGITAL_TEXT:
                lines = _extract_text_page_lines(page, page_no)
                zones = partition_zones(lines, page_no, page.rect.width, page.rect.height)
                # body lines through the cascade; header/signature zones are
                # serialized by zone clustering in a later refinement (P0b).
                blocks = classifier.structure(zones.body)
                for b in blocks:
                    if getattr(b, "page", None) is None:
                        b.page = page_no
                all_blocks.extend(blocks)
            elif ptype == TABLE_HEAVY:
                # Primary: find_tables (free). Quality gate -> Gemini fallback (P1).
                lines = _extract_text_page_lines(page, page_no)
                zones = partition_zones(lines, page_no, page.rect.width, page.rect.height)
                blocks = classifier.structure(zones.body)
                for b in blocks:
                    if getattr(b, "page", None) is None:
                        b.page = page_no
                all_blocks.extend(blocks)
            else:  # SCANNED
                # Gemini vision contract (P1). Without an API key we degrade
                # gracefully: mark the page degraded, never silently drop it.
                report.degraded_pages.append(page_no)
                report.warnings.append(
                    f"page {page_no}: scanned page requires Gemini vision (not configured)"
                )

        # 4. Assembly / stitching
        media = media_dir or str(config.MEDIA_DIR)
        all_blocks = assemble(all_blocks, doc=doc, media_dir=media,
                              page_index_map=page_index_map)

        # 5. Rule engine
        rules = RuleEngine(config.SHARED_TYPOGRAPHY_PATH)
        rules.apply(all_blocks)

        # 6. Render
        builder = DocxBlockBuilder(rules)
        builder.save(all_blocks, out_path)

        # 7. Deliver — confidence summary + status
        confs = [b.confidence for b in all_blocks]
        report.confidence = sum(confs) / len(confs) if confs else 1.0
        if report.degraded_pages:
            failed_ratio = len(report.degraded_pages) / max(report.pages, 1)
            if failed_ratio > config.FAILED_PAGE_RATIO or 1 in report.degraded_pages:
                report.status = "failed"
            else:
                report.status = "completed_with_warnings"
        report.timings["total_s"] = round(time.time() - t0, 3)

        # P4 confidence-flag review (plan §10 thresholds).
        report.flagged_blocks = _flagged_blocks(all_blocks)
        report.low_confidence_pages = _low_confidence_pages(all_blocks)
        report.demotions = classifier.hier.demotions

        return str(Path(out_path).resolve()), report
    finally:
        # Always release the PyMuPDF handle — even on exceptions in stages
        # 2-6 — so the worker never leaks open document handles.
        doc.close()


def _block_preview(block: Block, limit: int = 80) -> str:
    """Short human-readable preview of a block for the review UI."""
    try:
        from eval.run_eval import block_text  # noqa: PLC0415
        text = block_text(block)
    except Exception:  # noqa: BLE001
        text = ""
    text = " ".join(text.split())
    return text[:limit]


def _flagged_blocks(blocks: list[Block]) -> list[dict]:
    """Blocks below the review threshold (plan §10: block < 0.6)."""
    out = []
    for i, b in enumerate(blocks):
        if b.confidence < config.BLOCK_REVIEW_THRESHOLD:
            out.append({
                "index": i,
                "type": b.type,
                "page": b.page,
                "confidence": round(b.confidence, 3),
                "preview": _block_preview(b),
            })
    return out


def _low_confidence_pages(blocks: list[Block]) -> list[dict]:
    """Pages whose average confidence is below threshold (plan §10: < 0.7)."""
    by_page: dict[int, list[float]] = {}
    for b in blocks:
        if b.page is not None:
            by_page.setdefault(b.page, []).append(b.confidence)
    out = []
    for page, vals in sorted(by_page.items()):
        avg = sum(vals) / len(vals)
        if avg < config.PAGE_REVIEW_THRESHOLD:
            out.append({"page": page, "avg_confidence": round(avg, 3), "blocks": len(vals)})
    return out
