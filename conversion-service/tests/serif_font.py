"""Cross-platform serif font resolution for PDF-building test fixtures.

Fixtures synthesize administrative PDFs with PyMuPDF and need a real font
file. The fixtures were authored against Windows (Times New Roman), but CI
runs on Linux, where Liberation Serif / DejaVu Serif take that role — both
cover the full Vietnamese extended-Latin range the fixtures exercise.

Resolution is candidate-list based so each platform keeps its most
faithful Times substitute first (Liberation Serif is metric-compatible
with Times New Roman). If nothing resolves we raise instead of falling
back to PyMuPDF's built-in Base-14 Times, which lacks Vietnamese glyphs
and would silently corrupt the fixtures.
"""
from __future__ import annotations

from pathlib import Path

_REGULAR_CANDIDATES = [
    r"C:\Windows\Fonts\times.ttf",  # Windows: Times New Roman
    # Linux (GitHub runners, Debian/Ubuntu): Times metric-compatible first
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    "/System/Library/Fonts/Supplemental/Times New Roman.ttf",  # macOS
]

_BOLD_CANDIDATES = [
    r"C:\Windows\Fonts\timesbd.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",
]


def serif_font_path(*, bold: bool = False) -> str:
    """First existing serif font file for this platform, Times on Windows."""
    for candidate in _BOLD_CANDIDATES if bold else _REGULAR_CANDIDATES:
        if Path(candidate).is_file():
            return candidate
    raise RuntimeError(
        "No serif font with Vietnamese coverage found for test fixtures; "
        "install fonts-liberation / fonts-liberation2 or fonts-dejavu-core"
    )


# Kept under the historical names so fixture call sites read unchanged.
TIMES = serif_font_path()
TIMESBD = serif_font_path(bold=True)
