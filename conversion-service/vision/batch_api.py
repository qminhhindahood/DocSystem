"""vision/batch_api.py — Gemini batch API for bulk jobs (P4).

The Gemini Batch API processes large volumes at reduced cost with relaxed
latency — ideal for bulk conversion of scanned documents. This module wraps
google-genai's batches API with the same transcription contract (§6) and
falls back to synchronous batch calls when the batches API is unavailable
or the SDK is too old.

Batch jobs are polled; results are validated through the same
schema.validator as the synchronous path (defense in depth).
"""
from __future__ import annotations

import logging
from typing import Any, Optional

import config
from schema.validator import validate_chunk
from vision.gemini_contract import (
    RESPONSE_SCHEMA,
    SYSTEM_PROMPT,
    GeminiVisionClient,
    plan_batches,
)

logger = logging.getLogger(__name__)

BATCH_POLL_INTERVAL_S = 5
BATCH_POLL_MAX_S = 600  # 10 minutes per batch before giving up


class GeminiBatchClient:
    """Bulk transcription via the Gemini Batch API (half-cost, relaxed latency)."""

    def __init__(self, client: Optional[GeminiVisionClient] = None):
        self.client = client or GeminiVisionClient()

    def supported(self) -> bool:
        """True when the pinned google-genai SDK exposes the batches API."""
        try:
            genai_client = self.client._get_client()
            return hasattr(genai_client, "batches")
        except Exception:  # noqa: BLE001
            return False

    def submit_bulk(self, pdf_bytes: bytes, page_numbers: list[int]) -> list[str]:
        """Submit one batch job per <=8-page chunk. Returns batch names."""
        from google.genai import types

        genai_client = self.client._get_client()
        names: list[str] = []
        for first, last in plan_batches(page_numbers):
            contents = [
                types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
                f"Transcribe pages {first}\u2013{last} of the attached document "
                f"exactly as instructed. The \"page\" field must use the actual "
                f"page numbers in the file (the first page of this batch is page {first}).",
            ]
            batch = genai_client.batches.create(
                model=self.client.model,
                src=contents,
                config=types.CreateBatchJobConfig(
                    system_instruction=SYSTEM_PROMPT,
                    response_mime_type="application/json",
                    response_schema=RESPONSE_SCHEMA,
                    temperature=config.GEMINI_TEMPERATURE,
                ),
            )
            names.append(batch.name)
        return names

    def collect(self, batch_names: list[str]) -> list[Any]:
        """Poll batch jobs until done; return parsed+validated block lists.

        Failed or timed-out batches yield None at their position so the
        caller can degrade gracefully (§11) instead of losing the document.
        """
        import time

        from google.genai import types

        genai_client = self.client._get_client()
        results: list[Any] = [None] * len(batch_names)
        pending = {name: i for i, name in enumerate(batch_names)}
        deadline = time.time() + BATCH_POLL_MAX_S

        while pending and time.time() < deadline:
            for name, idx in list(pending.items()):
                try:
                    batch = genai_client.batches.get(name=name)
                except Exception as e:  # noqa: BLE001
                    logger.warning("batch %s poll failed: %s", name, e)
                    continue
                state = str(getattr(batch.state, "name", batch.state)).upper()
                if "SUCCEEDED" in state:
                    results[idx] = self._extract(batch)
                    del pending[name]
                elif "FAILED" in state or "CANCELLED" in state:
                    logger.warning("batch %s ended in state %s", name, state)
                    del pending[name]
            if pending:
                time.sleep(BATCH_POLL_INTERVAL_S)

        if pending:
            logger.warning("batches still pending at deadline: %s", list(pending))
        return results

    def _extract(self, batch: Any) -> Optional[list]:
        """Pull validated blocks out of a finished batch job."""
        try:
            responses = list(batch.inlined_responses or [])
        except Exception:  # noqa: BLE001
            return None
        blocks: list = []
        for resp in responses:
            text = getattr(resp, "text", None)
            if not text:
                continue
            import json

            try:
                raw = json.loads(text.strip())
            except json.JSONDecodeError:
                continue
            result = validate_chunk(raw)
            if result.ok:
                blocks.extend(result.blocks)
        return blocks or None
