"""quota.py — per-user daily quota (P3, plan §8 "New to add" #1).

Redis INCR with daily expiry; in-memory fallback mirrors the same semantics.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

import config

DEFAULT_DAILY_LIMIT = 20  # docs/day per user


class QuotaService:
    def __init__(self, redis_client=None, limit: int = DEFAULT_DAILY_LIMIT):
        self._redis = redis_client
        self.limit = limit
        self._memory: dict[str, tuple[int, float]] = {}

    def _key(self, user_id: str) -> str:
        day = datetime.now(timezone.utc).strftime("%Y%m%d")
        return f"conversion:quota:{user_id}:{day}"

    def check_and_increment(self, user_id: str) -> tuple[bool, int]:
        """Returns (allowed, remaining). Increments only when allowed."""
        key = self._key(user_id)
        if self._redis is not None:
            try:
                count = self._redis.incr(key)
                if count == 1:
                    # expire at end of the UTC day
                    self._redis.expire(key, 24 * 3600)
                if count > self.limit:
                    return False, 0
                return True, self.limit - count
            except Exception:  # noqa: BLE001
                self._redis = None
        # in-memory fallback
        now = time.time()
        count, expires = self._memory.get(key, (0, now + 86400))
        if now > expires:
            count, expires = 0, now + 86400
        count += 1
        self._memory[key] = (count, expires)
        if count > self.limit:
            return False, 0
        return True, self.limit - count
