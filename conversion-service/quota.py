"""quota.py — per-user daily quota (P3, plan §8 "New to add" #1).

Redis INCR with daily expiry; in-memory fallback mirrors the same semantics.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timezone

from redis.exceptions import WatchError

import config

DEFAULT_DAILY_LIMIT = 20  # docs/day per user


class QuotaService:
    def __init__(self, redis_client=None, limit: int = DEFAULT_DAILY_LIMIT):
        self._redis = redis_client
        self.limit = limit
        self._memory: dict[str, tuple[int, float]] = {}
        self._memory_lock = threading.Lock()

    def _key(self, user_id: str) -> str:
        day = datetime.now(timezone.utc).strftime("%Y%m%d")
        return f"conversion:quota:{user_id}:{day}"

    def check_and_increment(self, user_id: str) -> tuple[bool, int]:
        """Returns (allowed, remaining). Increments only when allowed."""
        key = self._key(user_id)
        if self._redis is not None:
            try:
                while True:
                    try:
                        with self._redis.pipeline() as pipe:
                            pipe.watch(key)
                            count = max(0, int(pipe.get(key) or 0))
                            if count >= self.limit:
                                pipe.unwatch()
                                return False, 0
                            pipe.multi()
                            pipe.incr(key)
                            if count == 0:
                                pipe.expire(key, 24 * 3600)
                            result = pipe.execute()
                            new_count = int(result[0])
                            return True, self.limit - new_count
                    except WatchError:
                        continue
            except Exception:  # noqa: BLE001
                self._redis = None
        # in-memory fallback
        now = time.time()
        with self._memory_lock:
            count, expires = self._memory.get(key, (0, now + 86400))
            if now > expires:
                count, expires = 0, now + 86400
            if count >= self.limit:
                return False, 0
            count += 1
            self._memory[key] = (count, expires)
            return True, self.limit - count

    def refund(self, user_id: str) -> None:
        """Give one conversion slot back (failed conversion). Never below zero."""
        key = self._key(user_id)
        if self._redis is not None:
            try:
                while True:
                    try:
                        with self._redis.pipeline() as pipe:
                            pipe.watch(key)
                            count = max(0, int(pipe.get(key) or 0))
                            if count == 0:
                                pipe.unwatch()
                                return
                            pipe.multi()
                            pipe.decr(key)
                            pipe.execute()
                            return
                    except WatchError:
                        continue
            except Exception:  # noqa: BLE001
                self._redis = None
        # in-memory fallback
        now = time.time()
        with self._memory_lock:
            count, expires = self._memory.get(key, (0, now + 86400))
            if now > expires:
                return
            self._memory[key] = (max(0, count - 1), expires)
