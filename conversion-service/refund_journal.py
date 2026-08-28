"""Persistent, secret-free quota refund recovery records."""
from __future__ import annotations

import json
import logging
import os
from dataclasses import asdict, dataclass
from pathlib import Path

import config

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PendingQuotaRefund:
    job_id: str
    user_id: str
    quota_key: str

    def payload(self) -> dict[str, str | bool]:
        return {
            "jobId": self.job_id,
            "userId": self.user_id,
            "quotaKey": self.quota_key,
            "refundOnly": True,
        }


def from_job(job: dict) -> PendingQuotaRefund | None:
    job_id = job.get("jobId")
    user_id = job.get("userId")
    quota_key = job.get("quotaKey")
    if not all(isinstance(value, str) and value for value in (job_id, user_id, quota_key)):
        return None
    return PendingQuotaRefund(job_id=job_id, user_id=user_id, quota_key=quota_key)


def _path(job_id: str) -> Path:
    if not job_id or Path(job_id).name != job_id or job_id in (".", ".."):
        raise ValueError("job_id must be a single path component")
    return config.REFUND_DIR / f"{job_id}.json"


def save_pending_refund(refund: PendingQuotaRefund) -> None:
    """Atomically persist the minimum data needed to refund after restart."""
    config.REFUND_DIR.mkdir(parents=True, exist_ok=True)
    target = _path(refund.job_id)
    temporary = target.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(asdict(refund), ensure_ascii=False),
        encoding="utf-8",
    )
    os.replace(temporary, target)


def delete_pending_refund(job_id: str) -> None:
    try:
        _path(job_id).unlink(missing_ok=True)
    except OSError as error:
        logger.warning("could not delete refund journal for job %s: %s", job_id, error)


def load_pending_refunds() -> list[PendingQuotaRefund]:
    if not config.REFUND_DIR.is_dir():
        return []
    refunds: list[PendingQuotaRefund] = []
    for path in config.REFUND_DIR.glob("*.json"):
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            refund = PendingQuotaRefund(
                job_id=raw["job_id"],
                user_id=raw["user_id"],
                quota_key=raw["quota_key"],
            )
            if _path(refund.job_id) != path:
                raise ValueError("refund journal filename mismatch")
            refunds.append(refund)
        except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
            logger.error("invalid refund journal %s: %s", path, error)
    return refunds
