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

import config
from admission import delete_source
from artifact_cleanup import (
    cleanup_expired_artifacts,
    delete_job_artifacts,
    mark_job_artifacts_complete,
)
from ingest.intake import IntakeError
from job_store import JobStore
from metrics import METRICS
from pipeline import convert_pdf
from quota import QuotaService
from user_errors import UNEXPECTED_CONVERSION_ERROR, VISION_AUTH_FAILED_DETAIL
from vision.gemini_contract import VisionAuthError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Quota refunds on failed conversions (ticket 02). Shares the JobStore's
# Redis client through its public property.
QUOTA = QuotaService()


def _refund_once(store: JobStore, job: dict) -> bool:
    """Refund the submitting user's quota once per failed job."""
    user_id = job.get("userId")
    if not user_id:
        return True
    flag_key = f"{config.JOB_STATE_PREFIX}{job['jobId']}:refunded"
    quota_key = job.get("quotaKey") or QUOTA._key(user_id)
    try:
        QUOTA.refund_charge_once(
            flag_key,
            quota_key,
            ttl_s=config.JOB_STATE_TTL_S,
        )
    except Exception as error:  # noqa: BLE001
        logger.warning("quota refund failed for job %s: %s", job["jobId"], error)
        return False
    store.update(
        job["jobId"],
        quotaRefunded=True,
        quotaRefundPending=False,
    )
    return True


def process_job(store: JobStore, job: dict) -> None:
    job_id = job["jobId"]
    pdf_path = job["pdfPath"]
    prior_state = store.load(job_id) or {}
    if prior_state.get("quotaRefundPending"):
        if _refund_once(store, job):
            store.finish_processing(job)
        else:
            time.sleep(config.QUOTA_REFUND_RETRY_DELAY_S)
            if not store.requeue_processing(job):
                logger.error("job %s refund remains pending in processing", job_id)
        delete_source(pdf_path)
        return

    refund_pending = False
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
            delete_job_artifacts(job_id)
            refund_pending = not _refund_once(store, job)
        else:
            mark_job_artifacts_complete(job_id)
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
        delete_job_artifacts(job_id)
        refund_pending = not _refund_once(store, job)
    except VisionAuthError:
        # BYOK fail-fast: the user's Gemini key was rejected. Clear message,
        # quota refunded once — never a page-by-page vague degradation.
        METRICS.inc("conversion_jobs_total", status="failed")
        METRICS.record_redis("jobs:failed", redis_client=store.redis_client)
        METRICS.record_outcome("failed")
        store.update(job_id, status="failed", progress=1.0,
                     error=VISION_AUTH_FAILED_DETAIL)
        delete_job_artifacts(job_id)
        refund_pending = not _refund_once(store, job)
    except Exception:  # noqa: BLE001
        logger.exception("job %s crashed", job_id)
        METRICS.inc("conversion_jobs_total", status="failed")
        METRICS.record_redis("jobs:failed", redis_client=store.redis_client)
        METRICS.record_outcome("failed")
        store.update(
            job_id, status="failed", progress=1.0,
            error=UNEXPECTED_CONVERSION_ERROR,
        )
        delete_job_artifacts(job_id)
        refund_pending = not _refund_once(store, job)
    finally:
        # Terminal state: clear the processing-list entry so the job is not
        # reclaimed, then remove the uploaded source. The DOCX result stays
        # until its JobStore record TTL expires.
        if refund_pending:
            store.update(job_id, quotaRefundPending=True)
            time.sleep(config.QUOTA_REFUND_RETRY_DELAY_S)
            if not store.requeue_processing(job):
                logger.error("job %s refund remains pending in processing", job_id)
        else:
            store.finish_processing(job)
        delete_source(pdf_path)


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
    cleanup_expired_artifacts()
    next_cleanup = time.monotonic() + config.FILE_CLEANUP_INTERVAL_S
    logger.info("conversion worker started (queue=%s)", config.CONVERSION_QUEUE_KEY)
    while True:
        if time.monotonic() >= next_cleanup:
            cleanup_expired_artifacts()
            next_cleanup = time.monotonic() + config.FILE_CLEANUP_INTERVAL_S
        job = store.dequeue()
        if job is None:
            continue
        process_job(store, job)


if __name__ == "__main__":
    run_worker()
