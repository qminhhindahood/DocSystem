"""tests/test_queue_durability.py — crash-safe queue semantics (ticket 02).

Seam: the Redis queue boundary — JobStore observable behaviour against a fake
Redis client. A crashed worker must never lose a Conversion Job: dequeue moves
the payload atomically into a processing list, terminal states clear it, and
startup reclaim re-queues anything left behind.
"""
import json
import sys
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import fakeredis

import config
from job_store import JobStore, RedisUnavailableError


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


def test_strict_store_raises_instead_of_falling_back_on_read(monkeypatch):
    fake = fakeredis.FakeRedis(decode_responses=True)
    store = JobStore(redis_client=fake, strict_redis=True)

    def fail_read(_key):
        raise ConnectionError("redis offline")

    monkeypatch.setattr(fake, "get", fail_read)

    try:
        store.load("strict-read")
    except RedisUnavailableError as error:
        assert "load" in str(error)
    else:
        raise AssertionError("strict Redis read unexpectedly fell back")
    assert store.redis_client is fake


def test_strict_store_raises_for_queue_and_terminal_cleanup(monkeypatch):
    fake = fakeredis.FakeRedis(decode_responses=True)
    store = JobStore(redis_client=fake, strict_redis=True)

    def fail_dequeue(*_args, **_kwargs):
        raise ConnectionError("redis offline")

    monkeypatch.setattr(fake, "brpoplpush", fail_dequeue)
    try:
        store.dequeue(timeout=1)
    except RedisUnavailableError as error:
        assert "dequeue" in str(error)
    else:
        raise AssertionError("strict dequeue unexpectedly returned None")

    monkeypatch.setattr(fake, "lrem", fail_dequeue)
    try:
        store.finish_processing({"jobId": "strict-cleanup"})
    except RedisUnavailableError as error:
        assert "finish processing" in str(error)
    else:
        raise AssertionError("strict terminal cleanup unexpectedly succeeded")


def test_api_store_reconnects_once_before_using_memory_fallback(monkeypatch):
    broken = fakeredis.FakeRedis(decode_responses=True)
    healthy = fakeredis.FakeRedis(decode_responses=True)
    key = f"{config.JOB_STATE_PREFIX}reconnected"
    healthy.set(key, json.dumps({"jobId": "reconnected"}))
    attempts = []

    def fail_read(_key):
        raise ConnectionError("stale connection")

    def reconnect(_url):
        attempts.append("connect")
        return healthy

    monkeypatch.setattr(broken, "get", fail_read)
    store = JobStore(redis_client=broken, redis_factory=reconnect)

    assert store.load("reconnected") == {"jobId": "reconnected"}
    assert attempts == ["connect"]
    assert store.redis_client is healthy


def test_bounded_enqueue_atomically_accepts_below_capacity():
    redis_client = Mock()
    redis_client.eval.return_value = 1
    store = JobStore(redis_client=redis_client)

    accepted = store.enqueue_bounded({"jobId": "j100"}, max_depth=100)

    assert accepted is True
    redis_client.eval.assert_called_once()
    args = redis_client.eval.call_args.args
    assert args[1:] == (
        1,
        config.CONVERSION_QUEUE_KEY,
        json.dumps({"jobId": "j100"}, ensure_ascii=False),
        100,
    )


def test_bounded_enqueue_atomically_refuses_at_capacity():
    redis_client = Mock()
    redis_client.eval.return_value = 0
    store = JobStore(redis_client=redis_client)

    accepted = store.enqueue_bounded({"jobId": "j101"}, max_depth=100)

    assert accepted is False
    redis_client.eval.assert_called_once()
