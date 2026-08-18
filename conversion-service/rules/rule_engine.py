"""rules/rule_engine.py — Decree 30 typography + inline-run derivation.

Loads shared/decree30-typography.json (the single source of truth, plan §8).
Styling that Decree 30 makes deterministic is applied HERE, never by the LLM:
- "Căn cứ" / law names -> italic runs on text-layer pages
- motto underline width -> fixed
- first_line_indent_pt -> derived from the typography rules, never observed
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from schema.blocks import (
    Block,
    HeadingBlock,
    ListBlock,
    ParagraphBlock,
    Run,
    TableBlock,
)

# ─── Deterministic inline-run rules (text pages) ─────────────────────────────
# Preamble legal-basis keywords and the legal instrument names that follow
# them are italic per Decree 30 Phụ lục I. These are RULES, not observations.

LEGAL_BASIS_KEYWORDS = (
    "Căn cứ", "căn cứ",
    "Xét", "xét",
    "Theo đề nghị", "theo đề nghị",
    "Thực hiện", "thực hiện",
)

# Law/ordinance/decree names: "Luật X", "Nghị định số …", "Thông tư …", etc.
_LAW_NAME_RE = re.compile(
    r"(Luật|Pháp lệnh|Nghị định|Nghị quyết|Thông tư|Quyết định|Chỉ thị|Hiến pháp)"
    r"(?:\s+(?:số\s+)?[\d\w/\.\-]+)*"
    r"(?:\s+ngày\s+\d{1,2}\s+tháng\s+\d{1,2}\s+năm\s+\d{4})?",
    re.UNICODE,
)


class RuleEngine:
    """Applies Decree 30 typography from the shared JSON to validated blocks."""

    def __init__(self, typography_path: str | Path):
        self.typography_path = Path(typography_path)
        self.typography: dict[str, Any] = json.loads(
            self.typography_path.read_text(encoding="utf-8")
        )

    # ── accessors ────────────────────────────────────────────────────────────
    @property
    def font_family(self) -> str:
        return self.typography["font"]["family"]

    @property
    def body_size_pt(self) -> float:
        return float(self.typography["font"]["default_body_size_pt"])

    @property
    def first_line_indent_pt(self) -> float:
        return float(self.typography["indent"]["first_line_pt"])

    @property
    def line_spacing(self) -> float:
        return float(self.typography["spacing"]["line_spacing"])

    @property
    def margins_mm(self) -> dict[str, float]:
        return {k: float(v) for k, v in self.typography["page"]["margins_mm"].items()}

    def block_style(self, block_type: str) -> dict[str, Any]:
        return self.typography["blocks"].get(block_type, {})

    def role_rule(self, role: str) -> dict[str, Any]:
        return self.typography["roles"].get(role, {})

    # ── run derivation ───────────────────────────────────────────────────────
    def derive_runs(self, text: str) -> list[Run]:
        """Deterministically derive inline runs for a text-layer paragraph.

        Rules (Decree 30 Phụ lục I):
        - a line starting with a legal-basis keyword -> whole line italic
        - law/ordinance/decree names inside the line -> italic span
        Otherwise a single plain run.
        """
        stripped = text.strip()
        if not stripped:
            return []

        for kw in LEGAL_BASIS_KEYWORDS:
            if stripped.startswith(kw):
                return [Run(text=text, italic=True)]

        runs: list[Run] = []
        pos = 0
        for m in _LAW_NAME_RE.finditer(text):
            if m.start() > pos:
                runs.append(Run(text=text[pos:m.start()]))
            runs.append(Run(text=m.group(0), italic=True))
            pos = m.end()
        if pos < len(text):
            runs.append(Run(text=text[pos:]))
        return runs or [Run(text=text)]

    # ── block enrichment ─────────────────────────────────────────────────────
    def apply(self, blocks: list[Block]) -> list[Block]:
        """Fill post-processing styling fields on every block (in place).

        - paragraph.first_line_indent_pt: derived from the typography rules
          (indentation is a rule, never an observation — §6.1)
        - paragraph.runs: derived when the block carries plain text and no runs
        """
        for b in blocks:
            if isinstance(b, ParagraphBlock):
                if b.first_line_indent_pt is None:
                    # Justified body paragraphs get the first-line indent;
                    # centered lines (titles, mottos) do not.
                    if (b.align or "justify") == "justify":
                        b.first_line_indent_pt = self.first_line_indent_pt
                if not b.runs and b.text:
                    b.runs = self.derive_runs(b.text)
        return blocks
