"""metrics.py — monitoring & alerts (P4, plan §9 observability).

Thread-safe in-process metrics: counters (jobs by status, pages by type,
degraded pages), duration + confidence observations, and a rolling outcome
window that drives the failure-rate alert surfaced on /health.

Exposed as Prometheus text format on GET /metrics.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from typing import Optional

ALERT_FAILURE_RATE = 0.20      # > 20% of recent jobs failed -> alert
ALERT_MIN_SAMPLES = 5          # need at least this many outcomes before alerting


class Metrics:
    def __init__(self, window: int = 500, outcomes: int = 50):
        self._lock = threading.Lock()
        self._counters: dict[str, float] = {}
        self._durations: deque[float] = deque(maxlen=window)
        self._confidences: deque[float] = deque(maxlen=window)
        self._outcomes: deque[str] = deque(maxlen=outcomes)
        self.started_at = time.time()

    # ── recording ────────────────────────────────────────────────────────────
    def inc(self, name: str, value: float = 1.0, **labels: str) -> None:
        key = self._key(name, labels)
        with self._lock:
            self._counters[key] = self._counters.get(key, 0.0) + value

    def observe_duration(self, seconds: float) -> None:
        with self._lock:
            self._durations.append(max(0.0, seconds))

    def observe_confidence(self, value: float) -> None:
        with self._lock:
            self._confidences.append(max(0.0, min(1.0, value)))

    def record_outcome(self, status: str) -> None:
        with self._lock:
            self._outcomes.append(status)

    # ── queries ──────────────────────────────────────────────────────────────
    @staticmethod
    def _key(name: str, labels: dict[str, str]) -> str:
        if not labels:
            return name
        parts = ",".join(f'{k}="{v}"' for k, v in sorted(labels.items()))
        return f"{name}{{{parts}}}"

    def failure_rate(self) -> Optional[float]:
        with self._lock:
            if len(self._outcomes) < ALERT_MIN_SAMPLES:
                return None
            failed = sum(1 for o in self._outcomes if o == "failed")
            return failed / len(self._outcomes)

    def alerts(self) -> list[str]:
        alerts: list[str] = []
        fr = self.failure_rate()
        if fr is not None and fr > ALERT_FAILURE_RATE:
            alerts.append(
                f"high_failure_rate: {fr:.0%} of the last {len(self._outcomes)} jobs failed"
            )
        return alerts

    def snapshot(self) -> dict:
        with self._lock:
            durations = sorted(self._durations)
            confs = list(self._confidences)
            jobs_observed = len(self._outcomes)
            out = {
                "uptime_s": round(time.time() - self.started_at, 1),
                "counters": dict(self._counters),
                "jobs_observed": jobs_observed,
                "duration_p50_s": durations[len(durations) // 2] if durations else None,
                "duration_p95_s": durations[int(len(durations) * 0.95)] if durations else None,
                "avg_confidence": sum(confs) / len(confs) if confs else None,
            }
        # failure_rate() acquires the lock too — call it OUTSIDE the with
        # block to avoid reentrancy deadlock (Lock is not reentrant).
        out["failure_rate"] = self.failure_rate() if jobs_observed >= ALERT_MIN_SAMPLES else None
        return out

    # ── Redis-shared counters (queue mode) ────────────────────────────────────
    # The standalone worker (worker.py) records into Redis so the API process
    # can aggregate them on /metrics — worker and API are separate processes
    # with separate in-memory registries.
    REDIS_METRICS_PREFIX = "conversion:metrics:"

    def record_redis(self, key: str, value: float = 1.0, redis_client=None) -> None:
        if redis_client is None:
            return
        rkey = f"{self.REDIS_METRICS_PREFIX}{key}"
        try:
            redis_client.incrbyfloat(rkey, value)
            # counters are cumulative by design; keep the key alive
            redis_client.expire(rkey, 7 * 86400)
        except Exception:  # noqa: BLE001
            pass

    # ── Prometheus text format ───────────────────────────────────────────────
    def render_prometheus(self, queue_depth: Optional[int] = None,
                          extra: Optional[dict[str, float]] = None) -> str:
        lines: list[str] = []
        with self._lock:
            for key, value in sorted(self._counters.items()):
                lines.append(f"{key} {value:g}")
            durations = sorted(self._durations)
            if durations:
                lines.append(
                    f"conversion_job_duration_seconds_p50 {durations[len(durations)//2]:g}"
                )
                lines.append(
                    f"conversion_job_duration_seconds_p95 {durations[int(len(durations)*0.95)]:g}"
                )
            confs = list(self._confidences)
            if confs:
                lines.append(f"conversion_confidence_avg {sum(confs)/len(confs):.4f}")
        if queue_depth is not None:
            lines.append(f"conversion_queue_depth {queue_depth}")
        if extra:
            for name, value in sorted(extra.items()):
                # name is e.g. "jobs:completed" -> conversion_jobs_completed_total
                metric = "conversion_" + name.replace(":", "_") + "_total"
                lines.append(f"{metric} {value:g}")
        fr = self.failure_rate()
        if fr is not None:
            lines.append(f"conversion_failure_rate {fr:.4f}")
        lines.append(f"conversion_uptime_seconds {time.time() - self.started_at:.0f}")
        return "\n".join(lines) + "\n"


METRICS = Metrics()
