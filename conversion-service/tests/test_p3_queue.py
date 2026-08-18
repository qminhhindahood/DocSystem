"""tests/test_p3_queue.py — P3 job store + quota (plan §8)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from job_store import JobStore, _MemoryStore
from quota import QuotaService


def test_memory_store_ttl_semantics():
    store = _MemoryStore()
    store.set("k", "v", ttl=100)
    assert store.get("k") == "v"
    store.set("expired", "x", ttl=-1)  # already expired
    assert store.get("expired") is None
    store.delete("k")
    assert store.get("k") is None


def test_job_store_fallback_roundtrip():
    # No Redis running in tests -> in-memory fallback
    store = JobStore(redis_url="redis://localhost:1")  # unreachable on purpose
    assert store.using_redis is False
    store.save("job-1", {"jobId": "job-1", "status": "queued"})
    state = store.load("job-1")
    assert state is not None and state["status"] == "queued"
    store.update("job-1", status="completed", confidence=0.9)
    state = store.load("job-1")
    assert state["status"] == "completed"
    assert state["confidence"] == 0.9


def test_job_store_unknown_job():
    store = JobStore(redis_url="redis://localhost:1")
    assert store.load("nope") is None


def test_quota_allows_until_limit():
    quota = QuotaService(redis_client=None, limit=3)
    ok1, rem1 = quota.check_and_increment("user-a")
    ok2, rem2 = quota.check_and_increment("user-a")
    ok3, rem3 = quota.check_and_increment("user-a")
    ok4, rem4 = quota.check_and_increment("user-a")
    assert (ok1, rem1) == (True, 2)
    assert (ok2, rem2) == (True, 1)
    assert (ok3, rem3) == (True, 0)
    assert (ok4, rem4) == (False, 0)


def test_quota_isolated_per_user():
    quota = QuotaService(redis_client=None, limit=1)
    assert quota.check_and_increment("user-a")[0] is True
    assert quota.check_and_increment("user-a")[0] is False
    assert quota.check_and_increment("user-b")[0] is True
