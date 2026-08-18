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

    def __init__(self, redis_url: Optional[str] = None):
        self.redis_url = redis_url or config.REDIS_URL
        self._redis = None
        self._memory = _MemoryStore()
        self._connect()

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
        """Blocking pop from the conversion_queue (worker side)."""
        if self._redis is None:
            return None
        try:
            item = self._redis.brpop(config.CONVERSION_QUEUE_KEY, timeout=timeout)
        except Exception as e:  # noqa: BLE001
            logger.warning("JobStore: dequeue failed (%s)", e)
            return None
        if not item:
            return None
        _, payload = item
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            return None
