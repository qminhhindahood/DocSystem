"""tests/test_quota_refund_on_failure.py — quota refund when a conversion fails (ticket 02).

Seam: the Redis queue boundary — QuotaService observable behaviour against a
fake Redis client, plus the worker's refund path with the pipeline stubbed.
A failed conversion must not consume the user's daily Quota.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import fakeredis

import config
import worker
from job_store import JobStore
from quota import QuotaService


def _quota_with_fake() -> QuotaService:
    return QuotaService(redis_client=fakeredis.FakeRedis(decode_responses=True), limit=3)


def _count(quota: QuotaService, user: str) -> int:
    return int(quota._redis.get(quota._key(user)) or 0)


def test_refund_decrements_counter():
    quota = _quota_with_fake()
    assert quota.check_and_increment("u1")[0] is True
    assert _count(quota, "u1") == 1

    quota.refund("u1")

    assert _count(quota, "u1") == 0
    # The refunded slot is usable again.
    allowed, remaining = quota.check_and_increment("u1")
    assert allowed is True and remaining == 2


def test_refund_never_below_zero():
    quota = _quota_with_fake()
    quota.refund("u2")  # nothing was ever charged
    assert _count(quota, "u2") == 0
    allowed, remaining = quota.check_and_increment("u2")
    assert allowed is True and remaining == 2


def test_refund_memory_fallback():
    quota = QuotaService(redis_client=None, limit=3)
    assert quota.check_and_increment("u3")[0] is True
    quota.refund("u3")
    allowed, remaining = quota.check_and_increment("u3")
    assert allowed is True and remaining == 2


def test_worker_refunds_quota_on_failed_conversion(monkeypatch, tmp_path):
    """A failed conversion refunds the submitting user exactly once."""
    store = JobStore(redis_client=fakeredis.FakeRedis(decode_responses=True))
    quota = QuotaService(redis_client=store.redis_client, limit=3)
    monkeypatch.setattr(worker, "QUOTA", quota)

    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    job = {"jobId": "jfail", "pdfPath": str(pdf), "filename": "doc.pdf", "userId": "u9"}
    store.save("jfail", {"jobId": "jfail", "status": "queued", "userId": "u9"})
    store.enqueue(job)
    dequeued = store.dequeue(timeout=1)

    class _FailedReport:
        status = "failed"
        page_types: dict = {}
        degraded_pages: list = []
        confidence = 0.0
        timings: dict = {}

    monkeypatch.setattr(
        worker, "convert_pdf",
        lambda pdf_path, out_path, media_dir, vision=None: (out_path, _FailedReport()),
    )

    assert quota.check_and_increment("u9")[0] is True  # charged on submit
    assert _count(quota, "u9") == 1

    worker.process_job(store, dequeued)

    assert _count(quota, "u9") == 0  # refunded on failure
    state = store.load("jfail")
    assert state["status"] == "failed"
    # The processing list is clear after the terminal state.
    assert store.redis_client.llen(config.CONVERSION_PROCESSING_KEY) == 0

    # A second terminal handling of the same job must not refund again.
    worker.process_job(store, dequeued)
    assert _count(quota, "u9") == 0
