"""job_store.py — job state persistence (P3).

Redis-backed with an in-memory fallback (mirrors the backend's RedisClient
pattern). Job records carry a TTL so uploads/outputs auto-expire (file TTL,
plan §8 "New to add").
"""
from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any, Optional

import config

logger = logging.getLogger(__name__)


class _MemoryStore:
    """Thread-safe in-memory fallback with TTL semantics."""

    def __init__(self) -> None:
        self._data: dict[str, tuple[str, float]] = {}
        self._lock = threading.Lock()

    def set(self, key: str, value: str, ttl: Optional[int] = None) -> None:
        expires = time.time() + ttl if ttl else float("inf")
        with self._lock:
            self._data[key] = (value, expires)

    def get(self, key: str) -> Optional[str]:
        with self._lock:
            item = self._data.get(key)
            if item is None:
                return None
            value, expires = item
            if time.time() > expires:
                del self._data[key]
                return None
            return value

    def delete(self, key: str) -> None:
        with self._lock:
            self._data.pop(key, None)


class JobStore:
    """Job state store: Redis when reachable, in-memory otherwise."""

    def __init__(self, redis_url: Optional[str] = None, redis_client=None):
        self.redis_url = redis_url or config.REDIS_URL
        self._redis = None
        self._memory = _MemoryStore()
        if redis_client is not None:
            self._redis = redis_client
        else:
            self._connect()

    @property
    def redis_client(self):
        """Public read access to the underlying Redis client (None in fallback mode)."""
        return self._redis

    def _connect(self) -> None:
        try:
            import redis

            client = redis.Redis.from_url(
                self.redis_url, socket_connect_timeout=2, decode_responses=True
            )
            client.ping()
            self._redis = client
            logger.info("JobStore: connected to Redis at %s", self.redis_url)
        except Exception as e:  # noqa: BLE001
            self._redis = None
            logger.warning("JobStore: Redis unavailable (%s); using in-memory fallback", e)

    @property
    def using_redis(self) -> bool:
        return self._redis is not None

    def _key(self, job_id: str) -> str:
        return f"{config.JOB_STATE_PREFIX}{job_id}"

    def save(self, job_id: str, state: dict[str, Any],
             ttl: int = config.JOB_STATE_TTL_S) -> None:
        payload = json.dumps(state, ensure_ascii=False)
        if self._redis is not None:
            try:
                self._redis.set(self._key(job_id), payload, ex=ttl)
                return
            except Exception as e:  # noqa: BLE001
                logger.warning("JobStore: Redis write failed (%s); falling back", e)
                self._redis = None
        self._memory.set(self._key(job_id), payload, ttl)

    def load(self, job_id: str) -> Optional[dict[str, Any]]:
        payload = None
        if self._redis is not None:
            try:
                payload = self._redis.get(self._key(job_id))
            except Exception as e:  # noqa: BLE001
                logger.warning("JobStore: Redis read failed (%s); falling back", e)
                self._redis = None
        if payload is None and self._redis is None:
            payload = self._memory.get(self._key(job_id))
        if payload is None:
            return None
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            return None

    def update(self, job_id: str, **fields: Any) -> Optional[dict[str, Any]]:
        state = self.load(job_id) or {}
        state.update(fields)
        self.save(job_id, state)
        return state

    def delete(self, job_id: str) -> None:
        """Remove one job state from the active backend and memory fallback."""
        key = self._key(job_id)
        if self._redis is not None:
            try:
                self._redis.delete(key)
            except Exception as error:  # noqa: BLE001
                logger.warning("JobStore: Redis delete failed (%s)", error)
        self._memory.delete(key)

    def enqueue(self, job: dict[str, Any]) -> None:
        """Push a job onto the conversion_queue list."""
        payload = json.dumps(job, ensure_ascii=False)
        if self._redis is not None:
            try:
                self._redis.lpush(config.CONVERSION_QUEUE_KEY, payload)
                return
            except Exception as e:  # noqa: BLE001
                logger.warning("JobStore: enqueue failed (%s)", e)
                self._redis = None
        raise RuntimeError("Redis is required for queue mode")

    def dequeue(self, timeout: int = config.QUEUE_POLL_TIMEOUT_S) -> Optional[dict[str, Any]]:
        """Atomically pop a job from the queue into the processing list.

        The payload stays visible in the processing list until the worker
        reports a terminal state (finish_processing), so a crashed worker
        leaves it behind for startup reclaim instead of losing it.
        """
        if self._redis is None:
            return None
        try:
            payload = self._redis.brpoplpush(
                config.CONVERSION_QUEUE_KEY,
                config.CONVERSION_PROCESSING_KEY,
                timeout=timeout,
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("JobStore: dequeue failed (%s)", e)
            return None
        if not payload:
            return None
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            # Corrupt payload: drop it from the processing list so it is not
            # reclaimed forever.
            try:
                self._redis.lrem(config.CONVERSION_PROCESSING_KEY, 1, payload)
            except Exception:  # noqa: BLE001
                pass
            return None

    def finish_processing(self, job: dict[str, Any]) -> None:
        """Remove the job's payload from the processing list (terminal state)."""
        if self._redis is None:
            return
        payload = json.dumps(job, ensure_ascii=False)
        try:
            self._redis.lrem(config.CONVERSION_PROCESSING_KEY, 1, payload)
        except Exception as e:  # noqa: BLE001
            logger.warning("JobStore: finish_processing failed (%s)", e)

    def requeue_processing(self, job: dict[str, Any]) -> bool:
        """Atomically move one processing payload back to the work queue."""
        if self._redis is None:
            return False
        payload = json.dumps(job, ensure_ascii=False)
        try:
            with self._redis.pipeline(transaction=True) as pipe:
                pipe.lrem(config.CONVERSION_PROCESSING_KEY, 1, payload)
                pipe.lpush(config.CONVERSION_QUEUE_KEY, payload)
                removed, _queued = pipe.execute()
            return int(removed) > 0
        except Exception as error:  # noqa: BLE001
            logger.warning("JobStore: refund retry requeue failed (%s)", error)
            return False

    def reclaim_processing(self) -> int:
        """Re-queue every payload left in the processing list (worker startup).

        A payload still sitting there means the previous worker died before
        finishing it; the job is re-queued intact. Returns the reclaim count.
        """
        if self._redis is None:
            return 0
        reclaimed = 0
        try:
            while True:
                payload = self._redis.rpoplpush(
                    config.CONVERSION_PROCESSING_KEY, config.CONVERSION_QUEUE_KEY
                )
                if payload is None:
                    break
                reclaimed += 1
        except Exception as e:  # noqa: BLE001
            logger.warning("JobStore: reclaim_processing failed (%s)", e)
        if reclaimed:
            logger.info(
                "JobStore: reclaimed %d in-flight job(s) from a previous worker",
                reclaimed,
            )
        return reclaimed
