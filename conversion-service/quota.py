"""quota.py — per-user daily quota (P3, plan §8 "New to add" #1).

Redis INCR with daily expiry; in-memory fallback mirrors the same semantics.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone

from redis.exceptions import WatchError

import config

DEFAULT_DAILY_LIMIT = 20  # docs/day per user


@dataclass(frozen=True)
class QuotaCharge:
    """The exact daily counter incremented for one admitted conversion."""

    user_id: str
    key: str


class QuotaService:
    def __init__(self, redis_client=None, limit: int = DEFAULT_DAILY_LIMIT):
        self._redis = redis_client
        self.limit = limit
        self._memory: dict[str, tuple[int, float]] = {}
        self._memory_lock = threading.Lock()

    def _key(self, user_id: str) -> str:
        day = datetime.now(timezone.utc).strftime("%Y%m%d")
        return f"conversion:quota:{user_id}:{day}"

    def charge(self, user_id: str) -> tuple[QuotaCharge | None, int]:
        """Atomically reserve a slot and return its exact counter identity."""
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
                                return None, 0
                            pipe.multi()
                            pipe.incr(key)
                            if count == 0:
                                pipe.expire(key, 24 * 3600)
                            result = pipe.execute()
                            new_count = int(result[0])
                            return QuotaCharge(user_id=user_id, key=key), self.limit - new_count
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
                return None, 0
            count += 1
            self._memory[key] = (count, expires)
            return QuotaCharge(user_id=user_id, key=key), self.limit - count

    def check_and_increment(self, user_id: str) -> tuple[bool, int]:
        """Returns (allowed, remaining). Increments only when allowed."""
        charge, remaining = self.charge(user_id)
        return charge is not None, remaining

    def refund(self, user_id: str) -> None:
        """Give one conversion slot back (failed conversion). Never below zero."""
        self.refund_charge(self._key(user_id))

    def refund_charge(self, charge: QuotaCharge | str) -> None:
        """Refund an admitted charge without recomputing its UTC-day key."""
        key = charge.key if isinstance(charge, QuotaCharge) else charge
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
