"""worker.py — Redis conversion_queue worker (P3, plan §8).

Consumes jobs from the conversion_queue list, runs the conversion pipeline,
and writes job state (status, progress, confidence, degradedPages) back to
the JobStore with TTL. Runs standalone:

    python worker.py

The FastAPI app enqueues jobs when Redis is reachable; otherwise it runs
them in-process (dev mode).
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

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def process_job(store: JobStore, job: dict) -> None:
    job_id = job["jobId"]
    pdf_path = job["pdfPath"]
    store.update(job_id, status="processing", progress=0.1)

    out_path = str(config.OUTPUT_DIR / f"{job_id}.docx")
    try:
        docx_path, report = convert_pdf(
            pdf_path, out_path, str(config.MEDIA_DIR / job_id)
        )
        METRICS.inc("conversion_jobs_total", status=report.status)
        METRICS.record_redis(f"jobs:{report.status}", redis_client=store._redis)
        for ptype, count in report.page_types.items():
            METRICS.inc("conversion_pages_total", type=ptype, value=float(count))
            METRICS.record_redis(f"pages:{ptype}", float(count), redis_client=store._redis)
        METRICS.inc("conversion_degraded_pages_total", value=float(len(report.degraded_pages)))
        METRICS.record_redis("degraded_pages", float(len(report.degraded_pages)), redis_client=store._redis)
        METRICS.observe_duration(report.timings.get("total_s", 0.0))
        METRICS.observe_confidence(report.confidence)
        METRICS.record_outcome(report.status)
        if report.status == "failed":
            store.update(job_id, status="failed", progress=1.0, report=asdict(report))
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
        METRICS.record_redis("jobs:failed", redis_client=store._redis)
        METRICS.record_outcome("failed")
        store.update(job_id, status="failed", progress=1.0, error=e.detail)
    except Exception as e:  # noqa: BLE001
        logger.exception("job %s crashed", job_id)
        METRICS.inc("conversion_jobs_total", status="failed")
        METRICS.record_redis("jobs:failed", redis_client=store._redis)
        METRICS.record_outcome("failed")
        store.update(job_id, status="failed", progress=1.0, error=str(e))
    finally:
        # File TTL: remove the uploaded source after processing. The DOCX
        # result stays until its JobStore record TTL expires.
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
    logger.info("conversion worker started (queue=%s)", config.CONVERSION_QUEUE_KEY)
    while True:
        job = store.dequeue()
        if job is None:
            continue
        process_job(store, job)


if __name__ == "__main__":
    run_worker()
