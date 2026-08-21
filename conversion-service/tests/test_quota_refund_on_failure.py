"""tests/test_quota_refund_on_failure.py — quota refund when a conversion fails (ticket 02).

Seam: the Redis queue boundary — QuotaService observable behaviour against a
fake Redis client, plus the worker's refund path with the pipeline stubbed.
A failed conversion must not consume the user's daily Quota.
"""
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import fakeredis

import config
import main
import worker
from job_store import JobStore
from pipeline import ConversionReport
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


def test_rejected_redis_submissions_do_not_consume_future_refund():
    quota = _quota_with_fake()
    for _ in range(3):
        assert quota.check_and_increment("u-limit")[0] is True

    for _ in range(5):
        assert quota.check_and_increment("u-limit") == (False, 0)

    quota.refund("u-limit")
    assert quota.check_and_increment("u-limit") == (True, 0)


def test_rejected_memory_submissions_do_not_consume_future_refund():
    quota = QuotaService(redis_client=None, limit=3)
    for _ in range(3):
        assert quota.check_and_increment("u-memory-limit")[0] is True

    for _ in range(5):
        assert quota.check_and_increment("u-memory-limit") == (False, 0)

    quota.refund("u-memory-limit")
    assert quota.check_and_increment("u-memory-limit") == (True, 0)


def test_concurrent_redis_admission_never_exceeds_limit():
    quota = _quota_with_fake()
    with ThreadPoolExecutor(max_workers=12) as executor:
        results = list(executor.map(
            lambda _: quota.check_and_increment("u-concurrent"),
            range(30),
        ))

    assert sum(1 for allowed, _ in results if allowed) == 3
    assert all(remaining == 0 for allowed, remaining in results if not allowed)
    quota.refund("u-concurrent")
    assert quota.check_and_increment("u-concurrent") == (True, 0)


def test_refund_charge_once_is_atomic_and_idempotent():
    quota = _quota_with_fake()
    charge, _remaining = quota.charge("atomic-user")
    assert charge is not None

    assert quota.refund_charge_once("refund:atomic-job", charge, ttl_s=60) is True
    assert quota.refund_charge_once("refund:atomic-job", charge, ttl_s=60) is False

    assert int(quota._redis.get(charge.key) or 0) == 0
    assert quota._redis.get("refund:atomic-job") == "1"


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


def test_worker_refunds_the_admission_day_after_utc_rollover(monkeypatch, tmp_path):
    store = JobStore(redis_client=fakeredis.FakeRedis(decode_responses=True))
    quota = QuotaService(redis_client=store.redis_client, limit=3)
    monkeypatch.setattr(worker, "QUOTA", quota)
    charge, _remaining = quota.charge("overnight-user")
    assert charge is not None
    next_day_key = "conversion:quota:overnight-user:20990102"
    quota._redis.set(next_day_key, 1)
    monkeypatch.setattr(quota, "_key", lambda _user_id: next_day_key)

    source = tmp_path / "overnight.pdf"
    source.write_bytes(b"%PDF-1.4 fake")
    job = {
        "jobId": "overnight-job",
        "pdfPath": str(source),
        "filename": "overnight.pdf",
        "userId": "overnight-user",
        "quotaKey": charge.key,
    }
    store.save("overnight-job", {
        "jobId": "overnight-job",
        "status": "queued",
        "userId": "overnight-user",
        "quotaKey": charge.key,
    })

    monkeypatch.setattr(
        worker,
        "convert_pdf",
        lambda *_args, **_kwargs: (
            "unused.docx",
            ConversionReport(status="failed", confidence=0.0),
        ),
    )

    worker.process_job(store, job)

    assert int(quota._redis.get(charge.key) or 0) == 0
    assert int(quota._redis.get(next_day_key) or 0) == 1


def test_in_process_failure_refunds_once(monkeypatch, tmp_path):
    quota = QuotaService(redis_client=None, limit=3)
    monkeypatch.setattr(main, "QUOTA", quota)
    charge, _remaining = quota.charge("local-refund-user")
    assert charge is not None
    source = tmp_path / "local-failure.pdf"
    source.write_bytes(b"%PDF-1.4 fake")
    main._LOCAL_JOBS["local-refund-job"] = {
        "jobId": "local-refund-job",
        "status": "queued",
        "userId": "local-refund-user",
        "quotaKey": charge.key,
    }

    def crash(*_args, **_kwargs):
        raise RuntimeError("conversion failed")

    monkeypatch.setattr(main, "convert_pdf", crash)

    import asyncio

    job = main.AdmittedJob(
        job_id="local-refund-job",
        pdf_path=str(source),
        filename="local-failure.pdf",
        user_id="local-refund-user",
        vision=None,
        quota_charge=charge,
    )
    asyncio.run(main._run_job_in_process(job))
    assert quota._memory[charge.key][0] == 0

    second_charge, _remaining = quota.charge("local-refund-user")
    assert second_charge is not None and second_charge.key == charge.key
    source.write_bytes(b"%PDF-1.4 fake")
    asyncio.run(main._run_job_in_process(job))

    assert quota._memory[charge.key][0] == 1


def test_in_process_refund_retries_without_manual_terminal_handling(
    monkeypatch, tmp_path
):
    quota = QuotaService(redis_client=None, limit=3)
    monkeypatch.setattr(main, "QUOTA", quota)
    monkeypatch.setattr(config, "QUOTA_REFUND_RETRY_DELAY_S", 0)
    charge, _remaining = quota.charge("local-retry-user")
    assert charge is not None
    source = tmp_path / "local-retry.pdf"
    source.write_bytes(b"%PDF-1.4 fake")
    job = main.AdmittedJob(
        job_id="local-retry-job",
        pdf_path=str(source),
        filename="local-retry.pdf",
        user_id="local-retry-user",
        vision=None,
        quota_charge=charge,
    )
    original = quota.refund_charge_once
    attempts = 0

    def fail_once(*args, **kwargs):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise ConnectionError("transient local refund failure")
        return original(*args, **kwargs)

    monkeypatch.setattr(quota, "refund_charge_once", fail_once)
    monkeypatch.setattr(
        main,
        "convert_pdf",
        lambda *_args, **_kwargs: (
            "unused.docx",
            ConversionReport(status="failed", confidence=0.0),
        ),
    )

    import asyncio

    async def run_and_wait_for_retry():
        await main._run_job_in_process(job)
        for _ in range(3):
            await asyncio.sleep(0)

    asyncio.run(run_and_wait_for_retry())

    assert quota._memory[charge.key][0] == 0
    assert main._LOCAL_JOBS[job.job_id]["quotaRefundPending"] is False
    assert job.job_id not in main._PENDING_REFUNDS


def test_worker_does_not_mark_refund_when_atomic_refund_fails(monkeypatch):
    store = JobStore(redis_client=fakeredis.FakeRedis(decode_responses=True))
    quota = QuotaService(redis_client=store.redis_client, limit=3)
    charge, _remaining = quota.charge("retry-user")
    assert charge is not None
    job = {
        "jobId": "retry-job",
        "userId": "retry-user",
        "quotaKey": charge.key,
    }
    store.save("retry-job", {"jobId": "retry-job", "userId": "retry-user"})
    monkeypatch.setattr(worker, "QUOTA", quota)
    original = quota.refund_charge_once
    attempts = 0

    def fail_once(*args, **kwargs):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise ConnectionError("refund unavailable")
        return original(*args, **kwargs)

    monkeypatch.setattr(quota, "refund_charge_once", fail_once)

    worker._refund_once(store, job)
    assert int(quota._redis.get(charge.key) or 0) == 1
    assert quota._redis.get(f"{config.JOB_STATE_PREFIX}retry-job:refunded") is None

    worker._refund_once(store, job)
    assert int(quota._redis.get(charge.key) or 0) == 0


def test_worker_requeues_failed_refund_as_refund_only_work(monkeypatch, tmp_path):
    store = JobStore(redis_client=fakeredis.FakeRedis(decode_responses=True))
    quota = QuotaService(redis_client=store.redis_client, limit=3)
    charge, _remaining = quota.charge("requeue-user")
    assert charge is not None
    source = tmp_path / "requeue.pdf"
    source.write_bytes(b"%PDF-1.4 fake")
    job = {
        "jobId": "requeue-job",
        "pdfPath": str(source),
        "filename": "requeue.pdf",
        "userId": "requeue-user",
        "quotaKey": charge.key,
    }
    store.save("requeue-job", {
        "jobId": "requeue-job",
        "status": "queued",
        "userId": "requeue-user",
        "quotaKey": charge.key,
    })
    store.enqueue(job)
    first = store.dequeue(timeout=1)
    monkeypatch.setattr(worker, "QUOTA", quota)
    monkeypatch.setattr(config, "QUOTA_REFUND_RETRY_DELAY_S", 0)
    conversions = 0

    def failed_conversion(*_args, **_kwargs):
        nonlocal conversions
        conversions += 1
        return "unused.docx", ConversionReport(status="failed", confidence=0.0)

    monkeypatch.setattr(worker, "convert_pdf", failed_conversion)
    original = quota.refund_charge_once
    attempts = 0

    def fail_once(*args, **kwargs):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise ConnectionError("transient refund failure")
        return original(*args, **kwargs)

    monkeypatch.setattr(quota, "refund_charge_once", fail_once)

    worker.process_job(store, first)
    assert store.redis_client.llen(config.CONVERSION_QUEUE_KEY) == 1
    assert store.load("requeue-job")["quotaRefundPending"] is True

    retry = store.dequeue(timeout=1)
    worker.process_job(store, retry)

    assert conversions == 1
    assert int(quota._redis.get(charge.key) or 0) == 0
    assert store.load("requeue-job")["quotaRefundPending"] is False
    assert store.redis_client.llen(config.CONVERSION_PROCESSING_KEY) == 0
