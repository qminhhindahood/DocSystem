"""Prove upload admission never blocks the FastAPI event loop.

Seam: the public HTTP contract of main.app, driven concurrently through
httpx.ASGITransport. Admission is stubbed to block inside a gate that the
test only releases AFTER a concurrent /health request has been served. If
admission ran on the event loop, the health probe could not complete until
the gate timed out, and the recorded completion order would put the upload
first (comprehensive review remediation, 2026-08-28).
"""
from __future__ import annotations

import asyncio
import threading
import time

import httpx

import main
from ingest.intake import IntakeError

PDF_BYTES = b"%PDF-1.4\n%minimal\n"
GATE_TIMEOUT_S = 2.0


def _install_gated_validate(monkeypatch):
    """Stub validate_and_save: signal start, hold the gate, then reject."""
    started = threading.Event()
    release = threading.Event()

    def gated_validate(fileobj, filename):
        started.set()
        release.wait(timeout=GATE_TIMEOUT_S)
        raise IntakeError(400, "gated reject")

    monkeypatch.setattr(main, "validate_and_save", gated_validate)
    return started, release


def test_single_admission_does_not_block_event_loop(monkeypatch):
    started, release = _install_gated_validate(monkeypatch)

    async def scenario():
        events: list[tuple[str, int]] = []
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:

            async def do_convert():
                response = await client.post(
                    "/convert",
                    files={"file": ("doc.pdf", PDF_BYTES, "application/pdf")},
                )
                events.append(("convert", response.status_code))

            async def do_health():
                response = await client.get("/health")
                events.append(("health", response.status_code))

            convert_task = asyncio.create_task(do_convert())
            deadline = time.monotonic() + GATE_TIMEOUT_S
            while not started.is_set():
                assert time.monotonic() < deadline, "admission never started"
                await asyncio.sleep(0.01)

            health_task = asyncio.create_task(do_health())
            # Health must be served while admission still holds the gate.
            await health_task
            release.set()
            await convert_task

        assert events[0] == ("health", 200), (
            f"/health must be served while admission is in progress; got {events}"
        )
        assert events[-1] == ("convert", 400)

    asyncio.run(scenario())


def test_bulk_admission_yields_event_loop_between_files(monkeypatch):
    started, release = _install_gated_validate(monkeypatch)

    async def scenario():
        events: list[tuple[str, int]] = []
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:

            async def do_bulk():
                response = await client.post(
                    "/convert/bulk",
                    files=[
                        ("files", ("a.pdf", PDF_BYTES, "application/pdf")),
                        ("files", ("b.pdf", PDF_BYTES, "application/pdf")),
                    ],
                )
                events.append(("bulk", response.status_code))
                return response

            async def do_health():
                response = await client.get("/health")
                events.append(("health", response.status_code))

            bulk_task = asyncio.create_task(do_bulk())
            deadline = time.monotonic() + GATE_TIMEOUT_S
            while not started.is_set():
                assert time.monotonic() < deadline, "admission never started"
                await asyncio.sleep(0.01)

            health_task = asyncio.create_task(do_health())
            # Health must be served while bulk admission still holds the gate.
            await health_task
            release.set()
            bulk_response = await bulk_task

        assert events[0] == ("health", 200), (
            f"/health must be served while bulk admission is in progress; got {events}"
        )
        assert events[-1] == ("bulk", 200)
        # Bulk stays ordered and bounded: per-file results, inline errors.
        body = bulk_response.json()
        assert body["count"] == 2
        assert [job["filename"] for job in body["jobs"]] == ["a.pdf", "b.pdf"]
        assert all(job["error"] == "gated reject" for job in body["jobs"])

    asyncio.run(scenario())
