"""tests/test_queue_durability.py — crash-safe queue semantics (ticket 02).

Seam: the Redis queue boundary — JobStore observable behaviour against a fake
Redis client. A crashed worker must never lose a Conversion Job: dequeue moves
the payload atomically into a processing list, terminal states clear it, and
startup reclaim re-queues anything left behind.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import fakeredis

import config
from job_store import JobStore


def _store_with_fake() -> JobStore:
    """A JobStore wired to an isolated fake Redis (queue mode)."""
    return JobStore(redis_client=fakeredis.FakeRedis(decode_responses=True))


def test_redis_client_is_publicly_readable():
    store = _store_with_fake()
    assert store.redis_client is not None
    assert store.redis_client.ping() is True


def test_dequeue_moves_payload_to_processing_list():
    store = _store_with_fake()
    store.enqueue({"jobId": "j1", "pdfPath": "/tmp/x.pdf"})

    job = store.dequeue(timeout=1)

    assert job is not None and job["jobId"] == "j1"
    assert store.redis_client.llen(config.CONVERSION_QUEUE_KEY) == 0
    assert store.redis_client.llen(config.CONVERSION_PROCESSING_KEY) == 1


def test_dequeue_empty_queue_returns_none():
    store = _store_with_fake()
    assert store.dequeue(timeout=1) is None
    assert store.redis_client.llen(config.CONVERSION_PROCESSING_KEY) == 0


def test_finish_processing_clears_processing_entry():
    store = _store_with_fake()
    store.enqueue({"jobId": "j2", "pdfPath": "/tmp/y.pdf"})
    job = store.dequeue(timeout=1)

    store.finish_processing(job)

    assert store.redis_client.llen(config.CONVERSION_PROCESSING_KEY) == 0
    assert store.redis_client.llen(config.CONVERSION_QUEUE_KEY) == 0


def test_reclaim_processing_requeues_leftover_payloads():
    store = _store_with_fake()
    # Simulate a crashed worker: two payloads sit in the processing list.
    fake = store.redis_client
    fake.lpush(config.CONVERSION_PROCESSING_KEY,
               json.dumps({"jobId": "j3", "pdfPath": "/tmp/a.pdf"}, ensure_ascii=False),
               json.dumps({"jobId": "j4", "pdfPath": "/tmp/b.pdf"}, ensure_ascii=False))

    reclaimed = store.reclaim_processing()

    assert reclaimed == 2
    assert fake.llen(config.CONVERSION_PROCESSING_KEY) == 0
    assert fake.llen(config.CONVERSION_QUEUE_KEY) == 2
    # Re-queued payloads are intact and consumable.
    job = store.dequeue(timeout=1)
    assert job is not None and job["jobId"] in ("j3", "j4")
