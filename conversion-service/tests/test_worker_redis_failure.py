import sys
from pathlib import Path

import fakeredis
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config
import worker
from job_store import JobStore, RedisUnavailableError
from pipeline import ConversionReport


def test_terminal_redis_failure_preserves_source_and_processing_entry(
    monkeypatch, tmp_path
):
    store = JobStore(
        redis_client=fakeredis.FakeRedis(decode_responses=True),
        strict_redis=True,
    )
    source = tmp_path / "reclaimable.pdf"
    source.write_bytes(b"%PDF-1.4 reclaimable")
    job = {
        "jobId": "redis-fault-job",
        "pdfPath": str(source),
        "filename": "reclaimable.pdf",
        "userId": "user-1",
    }
    store.save(job["jobId"], {"jobId": job["jobId"], "status": "queued"})
    store.enqueue(job)
    claimed = store.dequeue(timeout=1)

    monkeypatch.setattr(
        worker,
        "convert_pdf",
        lambda *_args, **_kwargs: (
            "unused.docx",
            ConversionReport(status="completed", confidence=1.0),
        ),
    )
    original_update = store.update
    update_count = 0

    def fail_terminal_update(job_id, **fields):
        nonlocal update_count
        update_count += 1
        if update_count == 2:
            raise RedisUnavailableError("Redis unavailable during save")
        return original_update(job_id, **fields)

    monkeypatch.setattr(store, "update", fail_terminal_update)

    with pytest.raises(RedisUnavailableError, match="save"):
        worker.process_job(store, claimed)

    assert source.exists()
    assert store.redis_client.llen(config.CONVERSION_PROCESSING_KEY) == 1


def test_worker_main_returns_nonzero_and_logs_redis_failure(monkeypatch, caplog):
    def fail_worker():
        raise RedisUnavailableError("Redis unavailable during dequeue")

    monkeypatch.setattr(worker, "run_worker", fail_worker)

    assert worker.worker_main() == 1
    assert "Redis unavailable during dequeue" in caplog.text
