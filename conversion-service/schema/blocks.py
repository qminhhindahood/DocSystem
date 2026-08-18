"""schema/blocks.py — the JSON contract (CONVERSION_SERVICE_PLAN.md §3).

Pydantic models for every block type. The LLM/classifier emits ONLY this
schema; the renderer consumes ONLY this schema. No free text, no regex
re-parsing of prose.

Field provenance (§3):
- LLM-supplied (scanned path): every field except the post-processing ones.
- Classifier-supplied (text path): same fields, plus `page` stamped per §5.
- Post-processing, NEVER model output: `anchor_block` (assembler infers from
  bbox zone), `first_line_indent_pt` (rule engine derives), `src` on the
  scanned path (assembler crops the page pixmap at the bbox).
"""
from __future__ import annotations

from typing import Annotated, Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator

# ─── Shared sub-models ────────────────────────────────────────────────────────

class Run(BaseModel):
    """Inline styled run. Styling hints are OBSERVED (scanned pages) or
    DERIVED (rule engine, text pages) — never invented by the model."""
    model_config = ConfigDict(extra="forbid")

    text: str
    bold: Optional[bool] = None
    italic: Optional[bool] = None
    underline: Optional[bool] = None


class ListItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str
    runs: list[Run] = Field(default_factory=list)


class TableCell(BaseModel):
    """Table cell; merged cells expressed via colspan/rowspan."""
    model_config = ConfigDict(extra="forbid")

    text: str = ""
    colspan: int = Field(default=1, ge=1)
    rowspan: int = Field(default=1, ge=1)
    align: Optional[Literal["left", "center", "right", "justify"]] = None
    bold: Optional[bool] = None


class AdminHeaderLeft(BaseModel):
    """Typed union of admin_header.left fields (plan §6.3: every OBJECT in a
    Gemini response_schema must declare properties)."""
    model_config = ConfigDict(extra="forbid")

    superior_agency: Optional[str] = None
    issuing_agency: Optional[str] = None
    document_number: Optional[str] = None


class AdminHeaderRight(BaseModel):
    model_config = ConfigDict(extra="forbid")

    country_name: Optional[str] = None
    motto: Optional[str] = None
    location_and_date: Optional[str] = None


class SignatureLeft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    receipt_list: list[str] = Field(default_factory=list)


class SignatureRight(BaseModel):
    model_config = ConfigDict(extra="forbid")

    authority: Optional[str] = None
    title: Optional[str] = None
    name: Optional[str] = None


# ─── bbox helper ──────────────────────────────────────────────────────────────

BBox = list[int]  # [x0, y0, x1, y1] on a 0-1000 x 0-1000 grid, top-left origin


def _check_bbox(v: BBox) -> BBox:
    if len(v) != 4:
        raise ValueError("bbox must have exactly 4 integers [x0, y0, x1, y1]")
    x0, y0, x1, y1 = v
    if not (0 <= x0 < x1 <= 1000 and 0 <= y0 < y1 <= 1000):
        raise ValueError(
            f"bbox {v} out of range: need 0<=x0<x1<=1000 and 0<=y0<y1<=1000"
        )
    return v


# ─── Block models ─────────────────────────────────────────────────────────────

class _BlockBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confidence: float = Field(ge=0.0, le=1.0)
    page: Optional[int] = Field(default=None, ge=1)  # 1-based; stamped per §5


class AdminHeaderBlock(_BlockBase):
    type: Literal["admin_header"] = "admin_header"
    left: AdminHeaderLeft = Field(default_factory=AdminHeaderLeft)
    right: AdminHeaderRight = Field(default_factory=AdminHeaderRight)


class HeadingBlock(_BlockBase):
    type: Literal["heading"] = "heading"
    level: int = Field(ge=1, le=6)
    text: str
    align: Optional[Literal["left", "center", "right", "justify"]] = None


class ParagraphBlock(_BlockBase):
    type: Literal["paragraph"] = "paragraph"
    text: Optional[str] = None  # optional when runs carry the content
    runs: list[Run] = Field(default_factory=list)
    align: Optional[Literal["left", "center", "right", "justify"]] = None
    # Post-processing field — the rule engine derives it; models never emit it.
    first_line_indent_pt: Optional[float] = None

    @field_validator("runs")
    @classmethod
    def _non_empty_content(cls, v: list[Run], info: Any) -> list[Run]:
        return v

    def plain_text(self) -> str:
        if self.text is not None:
            return self.text
        return "".join(r.text for r in self.runs)


class ListBlock(_BlockBase):
    type: Literal["list"] = "list"
    ordered: bool = True
    marker: str = "a)"  # a) | - | • | 1.
    items: list[ListItem] = Field(min_length=1)


class TableBlock(_BlockBase):
    type: Literal["table"] = "table"
    headers: list[list[TableCell]] = Field(default_factory=list)
    rows: list[list[TableCell]] = Field(default_factory=list)


class ImageBlock(_BlockBase):
    type: Literal["image"] = "image"
    kind: Literal["seal", "stamp", "signature", "photo", "diagram"]
    src: Optional[str] = None  # post-processing on scanned path (assembler fills)
    bbox: BBox
    placement: Literal["floating", "inline"] = "floating"
    # Post-processing — assembler infers deterministically from bbox zone.
    anchor_block: Optional[str] = None

    _bbox_check = field_validator("bbox")(lambda cls, v: _check_bbox(v))


class SignatureBlock(_BlockBase):
    type: Literal["signature"] = "signature"
    left: SignatureLeft = Field(default_factory=SignatureLeft)
    right: SignatureRight = Field(default_factory=SignatureRight)


class SectionBreakBlock(_BlockBase):
    type: Literal["section_break"] = "section_break"
    orientation: Literal["portrait", "landscape"] = "portrait"
    page_size: str = "A4"
    label: Optional[str] = None  # e.g. "PHỤ LỤC I"


class IllegibleBlock(_BlockBase):
    type: Literal["illegible"] = "illegible"
    bbox: BBox

    _bbox_check = field_validator("bbox")(lambda cls, v: _check_bbox(v))


Block = Annotated[
    Union[
        AdminHeaderBlock,
        HeadingBlock,
        ParagraphBlock,
        ListBlock,
        TableBlock,
        ImageBlock,
        SignatureBlock,
        SectionBreakBlock,
        IllegibleBlock,
    ],
    Field(discriminator="type"),
]

BLOCK_TYPES = (
    "admin_header", "heading", "paragraph", "list", "table",
    "image", "signature", "section_break", "illegible",
)


class BlockList(BaseModel):
    """Root container: a document (or chunk) is an ordered list of blocks."""
    model_config = ConfigDict(extra="forbid")

    blocks: list[Block]


def parse_blocks(data: Any) -> list[Block]:
    """Parse raw JSON (list of dicts) into validated Block models.

    Raises pydantic.ValidationError on malformed input — the validator module
    turns that into retry feedback text.
    """
    if not isinstance(data, list):
        raise ValueError("block list must be a JSON array")
    return BlockList(blocks=data).blocks


def blocks_to_dicts(blocks: list[Block]) -> list[dict[str, Any]]:
    return [b.model_dump(mode="json", exclude_none=True) for b in blocks]
