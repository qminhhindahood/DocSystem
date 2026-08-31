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
from typing import Any, Callable, Optional, TypeVar

import config

logger = logging.getLogger(__name__)
T = TypeVar("T")


class RedisUnavailableError(RuntimeError):
    """A Redis-backed operation could not be completed durably."""


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
    """Job state store: strict Redis for workers, fallback for local API use."""

    _BOUNDED_ENQUEUE_SCRIPT = """
local depth = redis.call('LLEN', KEYS[1])
if depth >= tonumber(ARGV[2]) then
  return 0
end
redis.call('LPUSH', KEYS[1], ARGV[1])
return 1
""".strip()

    def __init__(
        self,
        redis_url: Optional[str] = None,
        redis_client=None,
        *,
        strict_redis: bool = False,
        redis_factory: Optional[Callable[[str], Any]] = None,
    ):
        self.redis_url = redis_url or config.REDIS_URL
        self._redis = None
        self._memory = _MemoryStore()
        self.strict_redis = strict_redis
        self._redis_factory = redis_factory or self._default_redis_factory
        if redis_client is not None:
            self._redis = redis_client
        else:
            self._connect()

    @property
    def redis_client(self):
        """Public read access to the underlying Redis client (None in fallback mode)."""
        return self._redis

    @staticmethod
    def _default_redis_factory(redis_url: str):
        import redis

        return redis.Redis.from_url(
            redis_url, socket_connect_timeout=2, decode_responses=True
        )

    def _new_client(self):
        client = self._redis_factory(self.redis_url)
        client.ping()
        return client

    def _connect(self) -> None:
        try:
            self._redis = self._new_client()
            logger.info("JobStore: connected to Redis at %s", self.redis_url)
        except Exception as e:  # noqa: BLE001
            self._redis = None
            if self.strict_redis:
                raise RedisUnavailableError(
                    "Redis unavailable during connect"
                ) from e
            logger.warning("JobStore: Redis unavailable (%s); using in-memory fallback", e)

    def _reconnect_once(self) -> bool:
        try:
            self._redis = self._new_client()
            logger.info("JobStore: reconnected to Redis at %s", self.redis_url)
            return True
        except Exception as error:  # noqa: BLE001
            self._redis = None
            logger.warning("JobStore: Redis reconnect failed (%s)", error)
            return False

    def _redis_call(
        self,
        operation: str,
        call: Callable[[Any], T],
    ) -> tuple[bool, Optional[T]]:
        if self._redis is None:
            if self.strict_redis:
                raise RedisUnavailableError(
                    f"Redis unavailable during {operation}"
                )
            return False, None
        try:
            return True, call(self._redis)
        except Exception as first_error:  # noqa: BLE001
            if self.strict_redis:
                raise RedisUnavailableError(
                    f"Redis unavailable during {operation}"
                ) from first_error
            logger.warning(
                "JobStore: Redis %s failed (%s); reconnecting once",
                operation,
                first_error,
            )
            if self._reconnect_once():
                try:
                    return True, call(self._redis)
                except Exception as retry_error:  # noqa: BLE001
                    logger.warning(
                        "JobStore: Redis %s retry failed (%s); using fallback",
                        operation,
                        retry_error,
                    )
            self._redis = None
            return False, None

    @property
    def using_redis(self) -> bool:
        return self._redis is not None

    def _key(self, job_id: str) -> str:
        return f"{config.JOB_STATE_PREFIX}{job_id}"

    def save(self, job_id: str, state: dict[str, Any],
             ttl: int = config.JOB_STATE_TTL_S) -> None:
        payload = json.dumps(state, ensure_ascii=False)
        stored, _ = self._redis_call(
            "save",
            lambda client: client.set(self._key(job_id), payload, ex=ttl),
        )
        if stored:
            return
        self._memory.set(self._key(job_id), payload, ttl)

    def load(self, job_id: str) -> Optional[dict[str, Any]]:
        loaded, payload = self._redis_call(
            "load",
            lambda client: client.get(self._key(job_id)),
        )
        if not loaded:
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
        self._redis_call("delete", lambda client: client.delete(key))
        self._memory.delete(key)

    def enqueue(self, job: dict[str, Any]) -> None:
        """Push a job onto the conversion_queue list."""
        payload = json.dumps(job, ensure_ascii=False)
        queued, _ = self._redis_call(
            "enqueue",
            lambda client: client.lpush(config.CONVERSION_QUEUE_KEY, payload),
        )
        if queued:
            return
        raise RuntimeError("Redis is required for queue mode")

    def enqueue_bounded(self, job: dict[str, Any], max_depth: int) -> bool:
        """Atomically enqueue one job unless the pending queue is at capacity."""
        if max_depth <= 0:
            raise ValueError("max_depth must be positive")
        payload = json.dumps(job, ensure_ascii=False)
        queued, accepted = self._redis_call(
            "bounded enqueue",
            lambda client: client.eval(
                self._BOUNDED_ENQUEUE_SCRIPT,
                1,
                config.CONVERSION_QUEUE_KEY,
                payload,
                max_depth,
            ),
        )
        if not queued:
            raise RuntimeError("Redis is required for queue mode")
        return int(accepted or 0) == 1

    def dequeue(self, timeout: int = config.QUEUE_POLL_TIMEOUT_S) -> Optional[dict[str, Any]]:
        """Atomically pop a job from the queue into the processing list.

        The payload stays visible in the processing list until the worker
        reports a terminal state (finish_processing), so a crashed worker
        leaves it behind for startup reclaim instead of losing it.
        """
        dequeued, payload = self._redis_call(
            "dequeue",
            lambda client: client.brpoplpush(
                config.CONVERSION_QUEUE_KEY,
                config.CONVERSION_PROCESSING_KEY,
                timeout=timeout,
            ),
        )
        if not dequeued:
            return None
        if not payload:
            return None
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            # Corrupt payload: drop it from the processing list so it is not
            # reclaimed forever.
            self._redis_call(
                "discard corrupt processing payload",
                lambda client: client.lrem(
                    config.CONVERSION_PROCESSING_KEY, 1, payload
                ),
            )
            return None

    def finish_processing(self, job: dict[str, Any]) -> None:
        """Remove the job's payload from the processing list (terminal state)."""
        payload = json.dumps(job, ensure_ascii=False)
        self._redis_call(
            "finish processing",
            lambda client: client.lrem(
                config.CONVERSION_PROCESSING_KEY, 1, payload
            ),
        )

    def finish_refund_processing(self, job_id: str) -> int:
        """Remove every queued-processing variant for one completed refund."""
        def cleanup(client) -> int:
            removed = 0
            payloads = client.lrange(config.CONVERSION_PROCESSING_KEY, 0, -1)
            for payload in payloads:
                try:
                    decoded = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                if decoded.get("jobId") == job_id:
                    removed += int(client.lrem(
                        config.CONVERSION_PROCESSING_KEY,
                        0,
                        payload,
                    ))
            return removed

        cleaned, removed = self._redis_call("finish refund processing", cleanup)
        return int(removed or 0) if cleaned else 0

    def requeue_processing(
        self,
        job: dict[str, Any],
        replacement: Optional[dict[str, Any]] = None,
    ) -> bool:
        """Atomically replace one processing payload with queued retry work."""
        payload = json.dumps(job, ensure_ascii=False)
        queued_payload = json.dumps(replacement or job, ensure_ascii=False)
        def requeue(client) -> bool:
            with client.pipeline(transaction=True) as pipe:
                pipe.lrem(config.CONVERSION_PROCESSING_KEY, 1, payload)
                pipe.lpush(config.CONVERSION_QUEUE_KEY, queued_payload)
                removed, _queued = pipe.execute()
            return int(removed) > 0

        completed, moved = self._redis_call("requeue processing", requeue)
        return bool(moved) if completed else False

    def reclaim_processing(self) -> int:
        """Re-queue every payload left in the processing list (worker startup).

        A payload still sitting there means the previous worker died before
        finishing it; the job is re-queued intact. Returns the reclaim count.
        """
        def reclaim(client) -> int:
            reclaimed = 0
            while True:
                payload = client.rpoplpush(
                    config.CONVERSION_PROCESSING_KEY, config.CONVERSION_QUEUE_KEY
                )
                if payload is None:
                    break
                reclaimed += 1
            return reclaimed

        completed, reclaimed_value = self._redis_call(
            "reclaim processing", reclaim
        )
        reclaimed = int(reclaimed_value or 0) if completed else 0
        if reclaimed:
            logger.info(
                "JobStore: reclaimed %d in-flight job(s) from a previous worker",
                reclaimed,
            )
        return reclaimed
