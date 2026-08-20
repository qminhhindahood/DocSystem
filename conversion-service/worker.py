"""worker.py — Redis conversion_queue worker (P3, plan §8).

Consumes jobs from the conversion_queue list, runs the conversion pipeline,
and writes job state (status, progress, confidence, degradedPages) back to
the JobStore with TTL. Runs standalone:

    python worker.py

Durability (ticket 02): dequeue atomically moves each payload into a
processing list; terminal states clear it; on startup anything left in the
processing list by a crashed worker is re-queued. A failed conversion
refunds the submitting user's daily quota (at most once per job).
"""
from __future__ import annotations

import logging
import time
from dataclasses import asdict
from pathlib import Path

import config
from ingest.intake import IntakeError
from job_store import JobStore
from metrics import METRICS
from pipeline import convert_pdf
from quota import QuotaService
from vision.gemini_contract import VisionAuthError

# Clear Vietnamese message for a rejected BYOK key (fail-fast + refund).
VISION_AUTH_FAILED_DETAIL = (
    "Khóa API Gemini của bạn bị từ chối. Hãy kiểm tra lại khóa trong Cài đặt "
    "(biểu tượng bánh răng ở thanh bên) rồi thử lại."
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Quota refunds on failed conversions (ticket 02). Shares the JobStore's
# Redis client through its public property.
QUOTA = QuotaService()


def _refund_once(store: JobStore, job: dict) -> None:
    """Refund the submitting user's quota once per failed job."""
    user_id = job.get("userId")
    if not user_id:
        return
    flag_key = f"{config.JOB_STATE_PREFIX}{job['jobId']}:refunded"
    redis_client = store.redis_client
    if redis_client is not None:
        try:
            if redis_client.set(flag_key, "1", nx=True, ex=config.JOB_STATE_TTL_S):
                QUOTA.refund(user_id)
            return
        except Exception as e:  # noqa: BLE001
            logger.warning("refund flag check failed (%s); skipping refund", e)
            return
    # In-memory fallback: flag on the job state itself.
    state = store.load(job["jobId"]) or {}
    if not state.get("quotaRefunded"):
        store.update(job["jobId"], quotaRefunded=True)
        QUOTA.refund(user_id)


def process_job(store: JobStore, job: dict) -> None:
    job_id = job["jobId"]
    pdf_path = job["pdfPath"]
    store.update(job_id, status="processing", progress=0.1)

    out_path = str(config.OUTPUT_DIR / f"{job_id}.docx")
    try:
        docx_path, report = convert_pdf(
            pdf_path, out_path, str(config.MEDIA_DIR / job_id),
            vision=job.get("vision"),
        )
        METRICS.inc("conversion_jobs_total", status=report.status)
        METRICS.record_redis(f"jobs:{report.status}", redis_client=store.redis_client)
        for ptype, count in report.page_types.items():
            METRICS.inc("conversion_pages_total", type=ptype, value=float(count))
            METRICS.record_redis(f"pages:{ptype}", float(count), redis_client=store.redis_client)
        METRICS.inc("conversion_degraded_pages_total", value=float(len(report.degraded_pages)))
        METRICS.record_redis("degraded_pages", float(len(report.degraded_pages)), redis_client=store.redis_client)
        METRICS.observe_duration(report.timings.get("total_s", 0.0))
        METRICS.observe_confidence(report.confidence)
        METRICS.record_outcome(report.status)
        if report.status == "failed":
            store.update(job_id, status="failed", progress=1.0, report=asdict(report))
            _refund_once(store, job)
        else:
            store.update(
                job_id,
                status=report.status,
                progress=1.0,
                resultUrl=f"/convert/{job_id}/result",
                confidence=round(report.confidence, 3),
                degradedPages=report.degraded_pages,
                report=asdict(report),
            )
        logger.info("job %s -> %s", job_id, report.status)
    except IntakeError as e:
        METRICS.inc("conversion_jobs_total", status="failed")
        METRICS.record_redis("jobs:failed", redis_client=store.redis_client)
        METRICS.record_outcome("failed")
        store.update(job_id, status="failed", progress=1.0, error=e.detail)
        _refund_once(store, job)
    except VisionAuthError:
        # BYOK fail-fast: the user's Gemini key was rejected. Clear message,
        # quota refunded once — never a page-by-page vague degradation.
        METRICS.inc("conversion_jobs_total", status="failed")
        METRICS.record_redis("jobs:failed", redis_client=store.redis_client)
        METRICS.record_outcome("failed")
        store.update(job_id, status="failed", progress=1.0,
                     error=VISION_AUTH_FAILED_DETAIL)
        _refund_once(store, job)
    except Exception as e:  # noqa: BLE001
        logger.exception("job %s crashed", job_id)
        METRICS.inc("conversion_jobs_total", status="failed")
        METRICS.record_redis("jobs:failed", redis_client=store.redis_client)
        METRICS.record_outcome("failed")
        store.update(job_id, status="failed", progress=1.0, error=str(e))
        _refund_once(store, job)
    finally:
        # Terminal state: clear the processing-list entry so the job is not
        # reclaimed, then remove the uploaded source. The DOCX result stays
        # until its JobStore record TTL expires.
        store.finish_processing(job)
        try:
            if Path(pdf_path).exists():
                Path(pdf_path).unlink()
        except OSError:
            pass


def run_worker() -> None:
    config.ensure_dirs()
    store = JobStore()
    if not store.using_redis:
        raise SystemExit(
            "worker requires Redis (queue mode). Start Redis or run the API "
            "in in-process mode instead."
        )
    global QUOTA
    QUOTA = QuotaService(redis_client=store.redis_client)
    store.reclaim_processing()
    logger.info("conversion worker started (queue=%s)", config.CONVERSION_QUEUE_KEY)
    while True:
        job = store.dequeue()
        if job is None:
            continue
        process_job(store, job)


if __name__ == "__main__":
    run_worker()
