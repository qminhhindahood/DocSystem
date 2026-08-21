"""Convert accepted PyMuPDF table geometry into renderer-ready TableBlocks."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from schema.blocks import TableBlock, TableCell
from triage.triage import table_quality_gate


PdfBBox = tuple[float, float, float, float]


@dataclass(frozen=True)
class DetectedTable:
    block: TableBlock
    bbox: PdfBBox


def _text(value: Any) -> str:
    return " ".join(str(value or "").split())


def _bounds(table: Any, coordinate_indexes: tuple[int, int]) -> list[float]:
    values: set[float] = set()
    for row in table.rows:
        for cell in row.cells:
            if cell is None:
                continue
            values.add(round(float(cell[coordinate_indexes[0]]), 3))
            values.add(round(float(cell[coordinate_indexes[1]]), 3))
    return sorted(values)


def _span(bounds: list[float], start: float, end: float) -> int:
    tolerance = 0.5
    return max(
        1,
        sum(
            1
            for left, right in zip(bounds, bounds[1:])
            if left >= start - tolerance and right <= end + tolerance
        ),
    )


def _rows(table: Any) -> list[list[TableCell]]:
    extracted = table.extract() or []
    x_bounds = _bounds(table, (0, 2))
    y_bounds = _bounds(table, (1, 3))
    seen: set[PdfBBox] = set()
    result: list[list[TableCell]] = []

    for row_index, geometry_row in enumerate(table.rows):
        values = extracted[row_index] if row_index < len(extracted) else []
        cells: list[TableCell] = []
        for column_index, rect in enumerate(geometry_row.cells):
            if rect is None:
                continue
            bbox = tuple(float(value) for value in rect)
            if bbox in seen:
                continue
            seen.add(bbox)
            value = values[column_index] if column_index < len(values) else ""
            cells.append(TableCell(
                text=_text(value),
                colspan=_span(x_bounds, bbox[0], bbox[2]),
                rowspan=_span(y_bounds, bbox[1], bbox[3]),
            ))
        result.append(cells)
    return result


def _to_block(table: Any, page_number: int) -> TableBlock:
    rows = _rows(table)
    header = getattr(table, "header", None)
    header_names = [_text(value) for value in getattr(header, "names", [])]
    if header is not None and getattr(header, "external", False) and any(header_names):
        headers = [[TableCell(text=value, bold=True) for value in header_names]]
        body_rows = rows
    elif rows:
        headers = [
            [cell.model_copy(update={"bold": True}) for cell in rows[0]]
        ]
        body_rows = rows[1:]
    else:
        headers = []
        body_rows = []
    return TableBlock(
        headers=headers,
        rows=body_rows,
        confidence=0.92,
        page=page_number,
    )


def extract_accepted_tables(page: Any, page_number: int) -> tuple[list[DetectedTable], int]:
    """Return accepted tables in reading order and the rejected count."""
    accepted: list[DetectedTable] = []
    rejected = 0
    for table in page.find_tables().tables:
        if not table_quality_gate(table):
            rejected += 1
            continue
        bbox = tuple(float(value) for value in table.bbox)
        accepted.append(DetectedTable(block=_to_block(table, page_number), bbox=bbox))
    accepted.sort(key=lambda item: (item.bbox[1], item.bbox[0]))
    return accepted, rejected
