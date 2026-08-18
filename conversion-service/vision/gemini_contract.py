"""vision/gemini_contract.py — Gemini vision contract (plan §6), verbatim.

The SCANNED path lives or dies in this prompt. Implemented exactly as
specified: system prompt (§6.2), typed response_schema incl. the left/right
unions (§6.3), batching <= 8 pages, temperature 0.0, illegible-text policy.

Fields the LLM never reports: anchor_block, first_line_indent_pt, and src on
the scanned path — those are post-processing (§6.1).
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, Optional

import config

# ─── §6.2 System prompt (shippable text — do not freestyle) ───────────────────

SYSTEM_PROMPT = """You are a transcription engine for Vietnamese administrative documents
(Nghị định 30/2020/NĐ-CP).

TASK: Transcribe the provided scanned PDF pages into structured JSON.
You are a TRANSCRIBER, not an author.

ABSOLUTE RULES
1. Copy text EXACTLY as written — every word, number, date, and diacritic mark.
   Never paraphrase, summarize, "fix" typos, or complete cut-off text.
2. Never add content that does not appear on the page. Never omit visible content.
3. Partially illegible text: transcribe the readable part, replace unreadable spans
   with "…", and set that block's confidence low (0.3–0.6). NEVER guess illegible
   text. NEVER silently skip it.
4. Completely unreadable region: emit a block with type "illegible", its bbox, and
   confidence 0.1.
5. Report styling (bold/italic/underline) ONLY when you can actually see it.

BLOCK TYPES: admin_header | heading | paragraph | list | table | image | signature | illegible.

SEALS / STAMPS / SIGNATURES (MANDATORY — NEVER DROP)
- Every red seal (con dấu), ink stamp, and handwritten signature MUST be reported
  as an image block.
- kind: "seal" (round red organizational seal) | "stamp" (rectangular ink/name stamp)
  | "signature" (handwritten signature strokes) | "photo" | "diagram".
- bbox: [x0, y0, x1, y1] on a 0–1000 × 0–1000 grid normalized to the page,
  top-left origin.
- placement: "floating" for seals/stamps/signatures (they overlap other content);
  "inline" only for photos/diagrams within the text flow.
- Seals usually sit in the signature zone (bottom-right) and OVERLAP the signature
  and name. Report them even when they overlap text.

PAGE LAYOUT (administrative documents)
- Top of page 1: a two-column block — LEFT: superior agency, issuing agency,
  document number ("Số: …"); RIGHT: "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM",
  "Độc lập - Tự do - Hạnh phúc", place and date. Emit as ONE admin_header block.
- Bottom: signature zone — LEFT: "Nơi nhận" list; RIGHT: signing authority
  ("TM."/"KT."), title, signature area, full name. Emit as ONE signature block.
- Tables: report merged cells with colspan/rowspan; keep per-cell alignment.
- Lists: preserve the marker style (a), b), c) or - or 1.).
- Repeated running headers/footers and page numbers: do NOT transcribe as body content.

OUTPUT: JSON only, exactly matching the provided schema. No commentary, no markdown fences.
"""

USER_PROMPT_TEMPLATE = (
    "Transcribe pages {first}–{last} of the attached document exactly as instructed.\n"
    'The "page" field must use the actual page numbers in the file\n'
    "(the first page of this batch is page {first})."
)

# ─── §6.3 response_schema (google-genai SDK) ──────────────────────────────────

BLOCK_SCHEMA: dict[str, Any] = {
    "type": "OBJECT",
    "properties": {
        "page":       {"type": "INTEGER"},
        "type":       {"type": "STRING", "enum": [
            "admin_header", "heading", "paragraph", "list",
            "table", "image", "signature", "illegible"]},
        "text":       {"type": "STRING"},
        "level":      {"type": "INTEGER"},
        "align":      {"type": "STRING", "enum": ["left", "center", "right", "justify"]},
        "confidence": {"type": "NUMBER"},
        # paragraph runs — styling actually observed on the scan
        "runs": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "text": {"type": "STRING"}, "bold": {"type": "BOOLEAN"},
            "italic": {"type": "BOOLEAN"}, "underline": {"type": "BOOLEAN"}},
            "propertyOrdering": ["text", "bold", "italic", "underline"]}},
        # lists
        "ordered": {"type": "BOOLEAN"},
        "marker":  {"type": "STRING"},
        "items":   {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "text": {"type": "STRING"}}, "propertyOrdering": ["text"]}},
        # tables (merged cells via colspan/rowspan)
        "headers": {"type": "ARRAY", "items": {"type": "ARRAY", "items": {"type": "OBJECT",
            "properties": {
                "text": {"type": "STRING"}, "colspan": {"type": "INTEGER"},
                "rowspan": {"type": "INTEGER"}, "align": {"type": "STRING"},
                "bold": {"type": "BOOLEAN"}},
            "propertyOrdering": ["text", "colspan", "rowspan", "align", "bold"]}}},
        "rows": {"type": "ARRAY", "items": {"type": "ARRAY", "items": {"type": "OBJECT",
            "properties": {"text": {"type": "STRING"}, "align": {"type": "STRING"}},
            "propertyOrdering": ["text", "align"]}}},
        # images / seals
        "kind":      {"type": "STRING", "enum": ["seal", "stamp", "signature", "photo", "diagram"]},
        "bbox":      {"type": "ARRAY", "items": {"type": "INTEGER"}},
        "placement": {"type": "STRING", "enum": ["floating", "inline"]},
        # admin_header / signature sub-objects. Gemini REQUIRES properties on every
        # OBJECT (an untyped OBJECT is rejected or yields {}), so left/right are typed
        # as the UNION of both consumers' fields, all optional; the model fills
        # whichever apply to the block type.
        "left": {"type": "OBJECT", "properties": {
            # admin_header.left
            "superior_agency": {"type": "STRING"},
            "issuing_agency":  {"type": "STRING"},
            "document_number": {"type": "STRING"},
            # signature.left
            "receipt_list": {"type": "ARRAY", "items": {"type": "STRING"}},
        }, "propertyOrdering": [
            "superior_agency", "issuing_agency", "document_number", "receipt_list"]},
        "right": {"type": "OBJECT", "properties": {
            # admin_header.right
            "country_name":      {"type": "STRING"},
            "motto":             {"type": "STRING"},
            "location_and_date": {"type": "STRING"},
            # signature.right
            "authority": {"type": "STRING"},
            "title":     {"type": "STRING"},
            "name":      {"type": "STRING"},
        }, "propertyOrdering": [
            "country_name", "motto", "location_and_date", "authority", "title", "name"]},
    },
    "required": ["page", "type", "confidence"],
    "propertyOrdering": [
        "page", "type", "text", "level", "align", "confidence",
        "runs", "ordered", "marker", "items", "headers", "rows",
        "kind", "bbox", "placement", "left", "right"],
}

RESPONSE_SCHEMA: dict[str, Any] = {"type": "ARRAY", "items": BLOCK_SCHEMA}


# ─── Client ───────────────────────────────────────────────────────────────────

class GeminiVisionClient:
    """Thin wrapper around google-genai for the scanned-page contract.

    The SDK is imported lazily so the service (and its tests) run without
    google-genai installed or a GEMINI_API_KEY configured.
    """

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self.api_key = api_key or config.gemini_api_key()
        self.model = model or config.GEMINI_MODEL
        self._client = None

    def _get_client(self):
        if self._client is None:
            if not self.api_key:
                raise RuntimeError(
                    "GEMINI_API_KEY is not configured — scanned pages cannot be processed"
                )
            from google import genai  # lazy import
            self._client = genai.Client(api_key=self.api_key)
        return self._client

    def convert_scanned_batch(self, pdf_bytes: bytes, first_page: int, last_page: int):
        """One Gemini call for up to 8 pages (plan §6.3)."""
        from google.genai import types

        client = self._get_client()
        return client.models.generate_content(
            model=self.model,
            contents=[
                types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
                USER_PROMPT_TEMPLATE.format(first=first_page, last=last_page),
            ],
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,          # §6.2
                response_mime_type="application/json",
                response_schema=RESPONSE_SCHEMA,
                temperature=config.GEMINI_TEMPERATURE,     # 0.0 — deterministic
            ),
        )

    def extract_batch_json(self, pdf_bytes: bytes, first_page: int, last_page: int) -> Any:
        """Call + parse the JSON text into raw block dicts (pre-validation)."""
        resp = self.convert_scanned_batch(pdf_bytes, first_page, last_page)
        text = getattr(resp, "text", None)
        if text is None:
            # newer SDKs: assemble from candidates
            try:
                text = "".join(
                    part.text
                    for cand in resp.candidates
                    for part in (cand.content.parts or [])
                    if getattr(part, "text", None)
                )
            except Exception:
                text = None
        if not text:
            return None
        text = text.strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.startswith("json"):
                text = text[4:]
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return None


def plan_batches(page_numbers: list[int], batch_size: int = config.GEMINI_BATCH_PAGES):
    """Split page numbers into <=8-page batches -> (first, last) pairs."""
    batches = []
    for i in range(0, len(page_numbers), batch_size):
        chunk = page_numbers[i:i + batch_size]
        batches.append((chunk[0], chunk[-1]))
    return batches


async def convert_scanned_pages_parallel(
    client: GeminiVisionClient,
    pdf_bytes: bytes,
    page_numbers: list[int],
) -> list[Any]:
    """Run 4–8 batch calls in parallel (plan §6.1 batching)."""
    batches = plan_batches(page_numbers)
    sem = asyncio.Semaphore(config.GEMINI_PARALLEL_CALLS)

    async def one(first: int, last: int):
        async with sem:
            return await asyncio.to_thread(
                client.extract_batch_json, pdf_bytes, first, last
            )

    return await asyncio.gather(*(one(f, l) for f, l in batches))
