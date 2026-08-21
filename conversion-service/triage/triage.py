"""triage/triage.py — multi-signal per-page router (CONVERSION_SERVICE_PLAN.md §4).

page.get_text() alone is a DECEPTIVE signal for Vietnamese government PDFs:
ghost OCR layers, watermark/footer traps, and legacy TCVN3/VNI encodings
without ToUnicode CMaps all return non-empty but unusable text. Triage
combines signals exactly as specified in the plan.
"""
from __future__ import annotations

import config

# Page classes
SCANNED = "SCANNED"
TABLE_HEAVY = "TABLE_HEAVY"
DIGITAL_TEXT = "DIGITAL_TEXT"

VIET_DIACRITICS = set(
    "àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩị"
    "òóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ"
)


def has_fullpage_scan_image(page) -> bool:
    """True if any embedded raster image covers >= 70% of the page area."""
    page_area = page.rect.width * page.rect.height
    if page_area <= 0:
        return False
    for xref in {img[0] for img in page.get_images(full=True)}:
        for rect in page.get_image_rects(xref):
            if rect.width * rect.height >= config.FULLPAGE_IMAGE_COVERAGE * page_area:
                return True
    return False


def is_corrupted_encoding_or_bad_ocr(text: str) -> bool:
    """True when the text layer is unusable: legacy TCVN3/VNI fonts without a
    ToUnicode CMap (extracts as ASCII-only garbage) or failed OCR. Healthy
    Vietnamese prose carries diacritics on ~20-40% of letters, so a near-zero
    diacritic ratio is a reliable corruption signal."""
    sample = text[:2000]
    letters = [c for c in sample if c.isalpha()]
    if len(letters) < config.MIN_TRUSTED_LETTERS:
        return True                      # too little text to trust -> vision path
    diacritic_ratio = sum(1 for c in letters if c.lower() in VIET_DIACRITICS) / len(letters)
    replacement_ratio = sample.count("\ufffd") / len(sample)
    return (
        diacritic_ratio < config.DIACRITIC_RATIO_MIN
        or replacement_ratio > config.REPLACEMENT_RATIO_MAX
    )


def triage_page(page) -> str:
    """Classify one PyMuPDF page -> SCANNED | TABLE_HEAVY | DIGITAL_TEXT."""
    text = page.get_text().strip()

    # 1. No text at all -> scanned
    if not text:
        return SCANNED

    # 2. Full-page scan image + only a sliver of text (footer/watermark) -> scanned
    if has_fullpage_scan_image(page) and len(text) < config.SCANNED_TEXT_SLIVER_CHARS:
        return SCANNED

    # 3. Corrupted encoding / bad OCR (Vietnamese vowel ratio, known-word check) -> scanned
    if is_corrupted_encoding_or_bad_ocr(text):
        return SCANNED

    # 4. Table grid lines / vector geometry present -> table-heavy
    if len(page.find_tables().tables) > 0:
        return TABLE_HEAVY

    return DIGITAL_TEXT


def table_quality_gate(table) -> bool:
    """Accept a PyMuPDF find_tables() result only if cell fill >= 70% and
    >= 2 columns detected (plan §4 TABLE_HEAVY decision)."""
    try:
        rows = table.extract() or []
        col_count = int(getattr(table, "col_count", 0))
    except Exception:
        return False
    if not rows or col_count < config.TABLE_MIN_COLUMNS:
        return False
    total = sum(len(row) for row in rows)
    filled = sum(
        1
        for row in rows
        for cell in row
        if cell is not None and str(cell).strip()
    )
    return (filled / total) >= config.TABLE_CELL_FILL_MIN if total else False
