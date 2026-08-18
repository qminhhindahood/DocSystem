"""schema/validator.py — validate LLM/classifier output before the renderer.

Defense in depth (plan §3 Enforcement): Gemini's response_schema is the first
line; this validator is the second. Validation failures feed the chunk-retry
loop (§11) with human-readable error text.
"""
from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from .blocks import Block, parse_blocks


class ValidationResult:
    def __init__(self, blocks: list[Block] | None, errors: list[str]):
        self.blocks = blocks
        self.errors = errors

    @property
    def ok(self) -> bool:
        return self.blocks is not None and not self.errors

    def error_text(self) -> str:
        """Compact error text to feed back into a chunk retry (§11)."""
        return "; ".join(self.errors)


def _semantic_errors(blocks: list[Block]) -> list[str]:
    """Cross-field checks the Pydantic models cannot express."""
    errors: list[str] = []
    for i, b in enumerate(blocks):
        t = b.type
        if t == "paragraph":
            if not (b.text or "").strip() and not any(r.text.strip() for r in b.runs):
                errors.append(f"block[{i}] paragraph has no text and no runs")
        elif t == "heading":
            if not b.text.strip():
                errors.append(f"block[{i}] heading has empty text")
        elif t == "list":
            if not any(it.text.strip() for it in b.items):
                errors.append(f"block[{i}] list has only empty items")
        elif t == "table":
            if not b.headers and not b.rows:
                errors.append(f"block[{i}] table has no headers and no rows")
        elif t == "image":
            if b.placement == "floating" and b.kind in ("photo", "diagram"):
                # photos/diagrams live in the text flow; only seals/stamps/
                # signatures float (§6.2).
                errors.append(
                    f"block[{i}] image kind '{b.kind}' cannot be floating"
                )
        elif t == "admin_header":
            left = b.left
            right = b.right
            if not any([
                left.superior_agency, left.issuing_agency, left.document_number,
                right.country_name, right.motto, right.location_and_date,
            ]):
                errors.append(f"block[{i}] admin_header has no content in left/right")
        elif t == "signature":
            if not b.left.receipt_list and not any([
                b.right.authority, b.right.title, b.right.name,
            ]):
                errors.append(f"block[{i}] signature has no content in left/right")
    return errors


def validate_chunk(data: Any) -> ValidationResult:
    """Validate one chunk of raw JSON (list of block dicts).

    Returns ValidationResult with parsed blocks on success, or error text
    suitable for a chunk-retry prompt on failure.
    """
    if data is None:
        return ValidationResult(None, ["empty response: expected a JSON array of blocks"])

    if isinstance(data, dict) and "blocks" in data:
        data = data["blocks"]

    if not isinstance(data, list):
        return ValidationResult(
            None,
            [f"expected a JSON array of blocks, got {type(data).__name__}"],
        )

    try:
        blocks = parse_blocks(data)
    except ValidationError as e:
        errors = []
        for err in e.errors()[:10]:  # cap to keep retry feedback compact
            loc = ".".join(str(p) for p in err["loc"])
            errors.append(f"block {loc}: {err['msg']}")
        return ValidationResult(None, errors)
    except ValueError as e:
        return ValidationResult(None, [str(e)])

    semantic = _semantic_errors(blocks)
    if semantic:
        return ValidationResult(blocks, semantic)
    return ValidationResult(blocks, [])
