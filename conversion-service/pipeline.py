"""pipeline.py — per-document conversion orchestration (plan §7).

Wires: Ingest -> Triage -> Extract/Structure -> Assembly -> Rule engine ->
Render -> Deliver. Text pages run free (classifier cascade); scanned pages
route to the Gemini vision contract; TABLE_HEAVY uses find_tables primary +
quality gate with deterministic text fallback.
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
from structuring.admin_zones import build_admin_header, build_signature
from structuring.classifier import Classifier, LineInfo
from structuring.tables import DetectedTable, extract_accepted_tables
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
    extracted_chars: int = 0                                    # text-layer chars seen
    output_chars: int = 0                                       # content chars emitted
    coverage: float = 0.0                                       # output/extracted ratio


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
            text = "".join(s.get("text", "") for s in spans)
            # Normalize non-breaking spaces and soft hyphens so downstream
            # pattern matching and line-merge see ordinary text.
            text = text.replace("\u00a0", " ").replace("\u00ad", "-")
            text = " ".join(text.split())
            if not text:
                continue
            bbox = ln.get("bbox", (0, 0, 0, 0))
            size = max((s.get("size", 14.0) for s in spans), default=14.0)
            flags = spans[0].get("flags", 0)
            bold = bool(flags & 2 ** 4)
            italic = bool(flags & 2 ** 1)
            x0, y0, x1, y1 = bbox
            cx = (x0 + x1) / 2
            line_w = x1 - x0
            # A line is "centered" only when its midpoint sits near the page
            # center AND it is short. A justified body line spans ~the whole
            # text area, so its bbox center also lands near the page center —
            # that is justification, not centering. Long lines (> 60% of page
            # width) are never treated as centered regardless of midpoint.
            near_center = abs(cx - page_w / 2) < page_w * 0.08
            short_line = line_w < page_w * 0.60
            centered = near_center and short_line
            indented = x0 > page.rect.width * 0.12
            lines.append(LineInfo(
                text=text, size=size, bold=bold, italic=italic,
                centered=centered, indented=indented,
                page=page_number, y=y0, y1=y1, x0=x0, x1=x1,
            ))
    lines.sort(key=lambda l: l.y)
    return lines


def _run_scanned_vision(vision: dict, pdf_path: str,
                        scanned_pages: list[int]) -> tuple[list[Block], list[int], list[str]]:
    """Transcribe scanned pages with the user's injected Gemini key (BYOK).

    Returns (blocks, degraded_pages, warnings). Batches whose result is
    missing or fails validation degrade their pages with a warning — the
    degrade-don't-drop guarantee survives a bad batch. A rejected API key
    raises VisionAuthError, which the caller lets propagate (fail-fast).
    """
    import asyncio as _asyncio

    from vision.gemini_contract import (
        GeminiVisionClient,
        convert_scanned_pages_parallel,
        plan_batches,
    )

    client = GeminiVisionClient(api_key=vision["apiKey"], model=vision.get("model"))
    pdf_bytes = Path(pdf_path).read_bytes()
    batches = plan_batches(scanned_pages)
    results = _asyncio.run(
        convert_scanned_pages_parallel(client, pdf_bytes, scanned_pages)
    )

    blocks: list[Block] = []
    degraded: list[int] = []
    warnings: list[str] = []
    for batch, raw in zip(batches, results):
        batch_pages = list(batch)
        allowed_pages = set(batch_pages)
        batch_label = ", ".join(str(page) for page in batch_pages)
        if raw is None:
            degraded.extend(batch_pages)
            warnings.append(
                f"pages {batch_label}: Gemini vision returned no usable result"
            )
            continue
        result = validate_chunk(raw)
        if not result.ok:
            degraded.extend(batch_pages)
            warnings.append(
                f"pages {batch_label}: Gemini vision output failed validation "
                f"({result.error_text()})"
            )
            continue
        returned_pages: set[int] = set()
        for b in result.blocks:
            if getattr(b, "page", None) is None:
                if len(batch_pages) == 1:
                    b.page = batch_pages[0]
                else:
                    warnings.append(
                        f"pages {batch_label}: discarded a Gemini block without a page"
                    )
                    continue
            if b.page not in allowed_pages:
                warnings.append(
                    f"pages {batch_label}: discarded Gemini block for page {b.page}"
                )
                continue
            # Scanned extraction is capped even on a confident transcription.
            b.confidence = min(b.confidence, config.SCANNED_CONFIDENCE_CAP)
            returned_pages.add(b.page)
            blocks.append(b)
        missing_pages = sorted(allowed_pages - returned_pages)
        if missing_pages:
            degraded.extend(missing_pages)
            warnings.append(
                f"pages {', '.join(str(page) for page in missing_pages)}: "
                "Gemini returned no blocks for the selected page"
            )
    return blocks, degraded, warnings


def _stamp_page(blocks: list[Block], page_number: int) -> list[Block]:
    for block in blocks:
        if getattr(block, "page", None) is None:
            block.page = page_number
    return blocks


def _line_in_table(line: LineInfo, table: DetectedTable) -> bool:
    x = (line.x0 + line.x1) / 2
    y = (line.y + line.y1) / 2
    x0, y0, x1, y1 = table.bbox
    return x0 <= x <= x1 and y0 <= y <= y1


def _structure_body_with_tables(
    classifier: Classifier,
    body_lines: list[LineInfo],
    tables: list[DetectedTable],
    page_number: int,
) -> list[Block]:
    """Interleave non-table text segments and accepted tables by vertical position."""
    remaining = [
        line for line in body_lines
        if not any(_line_in_table(line, table) for table in tables)
    ]
    blocks: list[Block] = []
    cursor = 0
    for table in tables:
        before: list[LineInfo] = []
        while cursor < len(remaining) and (remaining[cursor].y + remaining[cursor].y1) / 2 < table.bbox[1]:
            before.append(remaining[cursor])
            cursor += 1
        blocks.extend(_stamp_page(classifier.structure(before), page_number))
        blocks.append(table.block)
    blocks.extend(_stamp_page(classifier.structure(remaining[cursor:]), page_number))
    return blocks


def convert_pdf(pdf_path: str, out_path: str,
                media_dir: Optional[str] = None,
                vision: Optional[dict] = None) -> tuple[str, ConversionReport]:
    """Convert one PDF to DOCX. Returns (docx_path, report).

    vision: optional BYOK Gemini config {"provider", "model", "apiKey"}
    injected from the submitting user's stored settings. Without it, scanned
    pages degrade with warnings (the admission gate in main.py already rejects
    scanned uploads that lack a key, so this path is defense in depth).
    """
    report = ConversionReport()
    t0 = time.time()

    # 1. Ingest — password rejection (Option A)
    check_password(pdf_path)
    doc = open_document(pdf_path)
    try:
        report.pages = len(doc)

        all_blocks: list[Block] = []
        page_index_map: dict[int, int] = {}
        sig_candidates: dict[int, Block] = {}
        scanned_pages: list[int] = []
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
                report.extracted_chars += sum(len(l.text) for l in lines)
                zones = partition_zones(lines, page_no, page.rect.width, page.rect.height)
                # Page-1 header zone -> AdminHeaderBlock (Quốc hiệu, tiêu ngữ,
                # cơ quan ban hành, số/KH, địa danh - ngày). Previously these
                # mandatory Decree-30 components were silently discarded.
                if page_no == 1:
                    hdr = build_admin_header(zones.header, page_no, page.rect.width)
                    if hdr is not None:
                        all_blocks.append(hdr)
                # Signature zone -> SignatureBlock (Nơi nhận + chữ ký), kept
                # for the LAST page that carries one (multi-page docs sign at
                # the end; earlier bottom zones are usually footers).
                sig = build_signature(zones.signature, page_no, page.rect.width)
                if sig is not None:
                    sig_candidates[page_no] = sig
                # body lines through the 4-stage cascade
                blocks = classifier.structure(zones.body)
                for b in blocks:
                    if getattr(b, "page", None) is None:
                        b.page = page_no
                all_blocks.extend(blocks)
            elif ptype == TABLE_HEAVY:
                # Primary: find_tables (free). Quality gate -> text fallback.
                lines = _extract_text_page_lines(page, page_no)
                report.extracted_chars += sum(len(l.text) for l in lines)
                zones = partition_zones(lines, page_no, page.rect.width, page.rect.height)
                if page_no == 1:
                    hdr = build_admin_header(zones.header, page_no, page.rect.width)
                    if hdr is not None:
                        all_blocks.append(hdr)
                sig = build_signature(zones.signature, page_no, page.rect.width)
                if sig is not None:
                    sig_candidates[page_no] = sig
                tables, rejected_tables = extract_accepted_tables(page, page_no)
                blocks = _structure_body_with_tables(
                    classifier, zones.body, tables, page_no
                )
                all_blocks.extend(blocks)
                if rejected_tables:
                    report.status = "completed_with_warnings"
                    report.warnings.append(
                        f"page {page_no}: {rejected_tables} detected table(s) failed "
                        "the quality gate and used text fallback"
                    )
            else:  # SCANNED
                # Gemini vision contract (P1). Collected here, transcribed in
                # one batched pass after the loop when the user injected a
                # BYOK key; without one the page degrades (never silently
                # dropped). main.py's admission gate already rejects scanned
                # uploads lacking a key, so the no-vision path is a backstop.
                scanned_pages.append(page_no)

        if scanned_pages:
            if vision:
                t_vision = time.time()
                v_blocks, v_degraded, v_warnings = _run_scanned_vision(
                    vision, pdf_path, scanned_pages
                )
                report.timings["vision_s"] = time.time() - t_vision
                all_blocks.extend(v_blocks)
                report.degraded_pages.extend(v_degraded)
                report.warnings.extend(v_warnings)
            else:
                for page_no in scanned_pages:
                    report.degraded_pages.append(page_no)
                    report.warnings.append(
                        f"page {page_no}: scanned page requires Gemini vision (not configured)"
                    )

        # Emit the signature block from the LAST page that carried one —
        # Decree-30 documents sign at the end; bottom zones on earlier pages
        # are footers, not signatures.
        if sig_candidates:
            all_blocks.append(sig_candidates[max(sig_candidates)])

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

        # 7. Deliver — confidence summary + status.
        #
        # Confidence is NEVER allowed to default to 1.0: an empty or partial
        # output must say so. We combine (a) the mean block confidence with
        # (b) a coverage ratio — content chars emitted vs text-layer chars
        # extracted. Empty output on a non-empty text layer is a hard failure,
        # not a perfect score.
        report.output_chars = _content_chars(all_blocks)
        if report.extracted_chars > 0:
            report.coverage = min(1.0, report.output_chars / report.extracted_chars)
        elif report.output_chars > 0:
            # Vision-produced content on a document with no text layer (fully
            # scanned): there is nothing to compare against, so coverage is not
            # a meaningful signal. Confidence still rides the (capped) block
            # average below — never a default 1.0.
            report.coverage = 1.0
        else:
            report.coverage = 0.0

        confs = [b.confidence for b in all_blocks]
        if not confs or report.output_chars == 0:
            if report.extracted_chars > 0:
                # Text was available but nothing usable was emitted.
                report.confidence = 0.0
                report.status = "failed"
                report.warnings.append(
                    "no content blocks were produced from a non-empty text layer"
                )
            else:
                report.confidence = 0.0
                report.status = "failed"
                report.warnings.append("document contained no extractable text")
        else:
            block_avg = sum(confs) / len(confs)
            # Coverage caps confidence: emitting 40% of the source text can
            # never be a 1.0 conversion.
            report.confidence = round(min(block_avg, report.coverage), 3)
            if report.coverage < config.COVERAGE_WARN_THRESHOLD:
                report.status = "completed_with_warnings"
                report.warnings.append(
                    f"content coverage is {report.coverage:.0%} of the extracted "
                    f"text layer ({report.output_chars}/{report.extracted_chars} chars)"
                )

        if report.degraded_pages:
            failed_ratio = len(report.degraded_pages) / max(report.pages, 1)
            if failed_ratio > config.FAILED_PAGE_RATIO or 1 in report.degraded_pages:
                report.status = "failed"
            else:
                report.status = "completed_with_warnings"
        if (
            report.status != "failed"
            and report.confidence < config.DOC_WARN_THRESHOLD
        ):
            report.status = "completed_with_warnings"
            report.warnings.append(
                f"document confidence is {report.confidence:.0%}, below the "
                f"{config.DOC_WARN_THRESHOLD:.0%} delivery threshold"
            )
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


def _content_chars(blocks: list[Block]) -> int:
    """Total content characters emitted across all blocks (coverage input)."""
    total = 0
    for b in blocks:
        t = getattr(b, "type", None)
        if t in ("paragraph", "heading"):
            total += len((getattr(b, "text", None) or "").strip())
        elif t == "list":
            total += sum(len((it.text or "").strip()) for it in b.items)
        elif t == "table":
            for row in list(b.headers) + list(b.rows):
                total += sum(len((c.text or "").strip()) for c in row)
        elif t == "admin_header":
            for v in (b.left.superior_agency, b.left.issuing_agency,
                      b.left.document_number, b.right.country_name,
                      b.right.motto, b.right.location_and_date):
                total += len((v or "").strip())
        elif t == "signature":
            total += sum(len(r.strip()) for r in b.left.receipt_list)
            for v in (b.right.authority, b.right.title, b.right.name):
                total += len((v or "").strip())
    return total


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
