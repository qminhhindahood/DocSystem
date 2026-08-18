"""main.py — FastAPI app for the PDF -> DOCX conversion service.

Endpoints (plan §8 integration contract):
  POST /convert            -> { jobId }
  GET  /convert/{jobId}    -> { status, progress, resultUrl, confidence, degradedPages }
  GET  /convert/{jobId}/result -> DOCX download
  GET  /health             -> liveness
  GET  /ready              -> readiness

Job execution modes:
  - QUEUE MODE: when Redis is reachable, jobs are enqueued on
    conversion_queue and the standalone worker (worker.py) processes them.
    Job state lives in the JobStore (Redis, TTL-bound).
  - IN-PROCESS MODE: without Redis (dev), jobs run in a thread pool and
    state lives in memory. The HTTP contract is identical.

Quota: an optional X-User-Id header (set by the Express backend after JWT
auth) enables the per-user daily doc cap (plan §8 "New to add" #1).
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import asdict
from typing import Any, Optional

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse

import config
from ingest.intake import IntakeError, check_password, validate_and_save
from job_store import JobStore
from metrics import METRICS
from pipeline import convert_pdf
from quota import QuotaService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Conversion Service", version=config.SERVICE_VERSION)

# Job state: Redis-backed when reachable, in-memory otherwise.
STORE = JobStore()
QUOTA = QuotaService(redis_client=STORE._redis)

# In-process fallback registry (dev mode only)
_LOCAL_JOBS: dict[str, dict[str, Any]] = {}
_LOCAL_JOB_CAP = 200


def _evict_local_jobs() -> None:
    """Bounded growth: evict oldest terminal jobs beyond the cap (dev mode)."""
    if len(_LOCAL_JOBS) <= _LOCAL_JOB_CAP:
        return
    terminal = [k for k, v in _LOCAL_JOBS.items()
                if v.get("status") in ("completed", "completed_with_warnings", "failed")]
    while len(_LOCAL_JOBS) > _LOCAL_JOB_CAP and terminal:
        _LOCAL_JOBS.pop(terminal.pop(0), None)


def _local_job(job_id: str, **fields: Any) -> dict[str, Any]:
    job = _LOCAL_JOBS.setdefault(job_id, {"jobId": job_id, "status": "queued", "progress": 0.0})
    job.update(fields)
    _evict_local_jobs()
    return job


def _record_job_metrics(report) -> None:
    METRICS.inc("conversion_jobs_total", status=report.status)
    for ptype, count in report.page_types.items():
        METRICS.inc("conversion_pages_total", type=ptype, value=float(count))
    METRICS.inc("conversion_degraded_pages_total", value=float(len(report.degraded_pages)))
    METRICS.observe_duration(report.timings.get("total_s", 0.0))
    METRICS.observe_confidence(report.confidence)
    METRICS.record_outcome(report.status)


async def _run_job_in_process(job_id: str, pdf_path: str, filename: str) -> None:
    _local_job(job_id, status="processing", progress=0.1)
    out_path = str(config.OUTPUT_DIR / f"{job_id}.docx")
    try:
        _local_job(job_id, progress=0.3)
        docx_path, report = await asyncio.to_thread(
            convert_pdf, pdf_path, out_path, str(config.MEDIA_DIR / job_id)
        )
        _local_job(job_id, progress=1.0)
        _record_job_metrics(report)
        if report.status == "failed":
            _local_job(job_id, status="failed", report=asdict(report))
        else:
            _local_job(job_id, status=report.status, resultUrl=f"/convert/{job_id}/result",
                       confidence=round(report.confidence, 3),
                       degradedPages=report.degraded_pages, report=asdict(report))
    except IntakeError as e:
        METRICS.inc("conversion_jobs_total", status="failed")
        METRICS.record_outcome("failed")
        _local_job(job_id, status="failed", error=e.detail)
    except Exception as e:  # noqa: BLE001
        logger.exception("conversion job %s failed", job_id)
        METRICS.inc("conversion_jobs_total", status="failed")
        METRICS.record_outcome("failed")
        _local_job(job_id, status="failed", error=str(e))


@app.get("/health")
async def health() -> dict[str, Any]:
    alerts = METRICS.alerts()
    return {"status": "healthy", "service": config.SERVICE_NAME,
            "version": config.SERVICE_VERSION,
            "queueMode": STORE.using_redis,
            "alerts": alerts}


@app.get("/ready")
async def ready():
    """Ready only when the typography source loads and work dirs are writable."""
    try:
        from rules.rule_engine import RuleEngine
        RuleEngine(config.SHARED_TYPOGRAPHY_PATH)
    except Exception as e:  # noqa: BLE001
        return JSONResponse(status_code=503, content={
            "status": "not ready", "detail": f"typography rules unavailable: {e}"})
    try:
        config.ensure_dirs()
    except Exception as e:  # noqa: BLE001
        return JSONResponse(status_code=503, content={
            "status": "not ready", "detail": f"work dirs unavailable: {e}"})
    return {"status": "ready", "typography": str(config.SHARED_TYPOGRAPHY_PATH),
            "queueMode": STORE.using_redis}


@app.get("/metrics", response_class=PlainTextResponse)
async def metrics() -> str:
    """Prometheus text format (P4 monitoring)."""
    queue_depth = None
    redis_worker = {}
    if STORE.using_redis:
        try:
            queue_depth = STORE._redis.llen(config.CONVERSION_QUEUE_KEY)
            # Aggregate worker-recorded counters (separate process writes to
            # Redis so the API can surface them on a single scrape endpoint).
            for key in STORE._redis.keys(METRICS.REDIS_METRICS_PREFIX + "*"):
                name = key[len(METRICS.REDIS_METRICS_PREFIX):]
                try:
                    redis_worker[name] = float(STORE._redis.get(key) or 0)
                except (TypeError, ValueError):
                    continue
        except Exception:  # noqa: BLE001
            redis_worker = {}
            queue_depth = None
    return METRICS.render_prometheus(queue_depth=queue_depth, extra=redis_worker)


@app.post("/convert")
async def convert(
    file: UploadFile = File(...),
    x_user_id: Optional[str] = Header(default=None),
) -> dict[str, Any]:
    """Accept a PDF upload, start a conversion job, return its jobId."""
    # Validate + password-check FIRST so rejected uploads never consume quota
    # (plan §8: the daily cap counts successful conversions, not garbage).
    try:
        pdf_path = validate_and_save(file.file, file.filename)
        # Option A (plan §7): reject pre-locked PDFs here, at Ingest.
        check_password(pdf_path)
    except IntakeError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    # Per-user daily quota (plan §8) — charged only after validation passes;
    # the just-saved staging file is removed if quota denies the upload so a
    # rejected file never lingers on disk.
    if x_user_id:
        allowed, remaining = QUOTA.check_and_increment(x_user_id)
        if not allowed:
            try:
                from pathlib import Path
                Path(pdf_path).unlink()
            except OSError:
                pass
            raise HTTPException(
                status_code=429,
                detail=f"Daily conversion quota exceeded ({QUOTA.limit} docs/day)",
            )

    job_id = uuid.uuid4().hex
    config.ensure_dirs()

    if STORE.using_redis:
        # Queue mode: persist state + enqueue for the worker.
        STORE.save(job_id, {
            "jobId": job_id, "status": "queued", "progress": 0.0,
            "filename": file.filename, "userId": x_user_id,
        })
        try:
            STORE.enqueue({"jobId": job_id, "pdfPath": pdf_path,
                           "filename": file.filename, "userId": x_user_id})
        except RuntimeError:
            # Redis vanished between check and enqueue — fall back in-process.
            _local_job(job_id, status="queued", filename=file.filename)
            asyncio.create_task(_run_job_in_process(job_id, pdf_path, file.filename or "upload.pdf"))
        return {"jobId": job_id, "mode": "queue"}

    # In-process dev mode
    _local_job(job_id, status="queued", filename=file.filename)
    asyncio.create_task(_run_job_in_process(job_id, pdf_path, file.filename or "upload.pdf"))
    return {"jobId": job_id, "mode": "in-process"}


def _find_job(job_id: str) -> Optional[dict[str, Any]]:
    """Job state from the store (queue mode) or local registry (dev mode)."""
    state = STORE.load(job_id)
    if state is not None:
        return state
    return _LOCAL_JOBS.get(job_id)


@app.get("/convert/{job_id}")
async def convert_status(job_id: str) -> dict[str, Any]:
    job = _find_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown jobId")
    return {
        "jobId": job_id,
        "status": job.get("status"),
        "progress": job.get("progress", 0.0),
        "resultUrl": job.get("resultUrl"),
        "confidence": job.get("confidence"),
        "degradedPages": job.get("degradedPages", []),
        "error": job.get("error"),
    }


@app.get("/convert/{job_id}/result")
async def convert_result(job_id: str):
    job = _find_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown jobId")
    if job.get("status") not in ("completed", "completed_with_warnings"):
        raise HTTPException(status_code=409, detail=f"Job is {job.get('status')}")
    path = config.OUTPUT_DIR / f"{job_id}.docx"
    if not path.exists():
        raise HTTPException(status_code=410, detail="Result file expired")
    return FileResponse(
        str(path),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"{job_id}.docx",
    )


@app.get("/convert/{job_id}/report")
async def convert_report(job_id: str) -> dict[str, Any]:
    """Confidence-flag review report (P4, plan §10/§12).

    Surfaces flagged blocks (confidence < 0.6), low-confidence pages
    (avg < 0.7), degraded pages, demotion count, and the document-level
    confidence so a human reviewer can spot-check.
    """
    job = _find_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown jobId")
    report = job.get("report") or {}
    return {
        "jobId": job_id,
        "status": job.get("status"),
        "confidence": job.get("confidence"),
        "degradedPages": job.get("degradedPages", []),
        "flaggedBlocks": report.get("flagged_blocks", []),
        "lowConfidencePages": report.get("low_confidence_pages", []),
        "demotions": report.get("demotions", 0),
        "pageTypes": report.get("page_types", {}),
        "warnings": report.get("warnings", []),
        "timings": report.get("timings", {}),
    }


@app.post("/convert/bulk")
async def convert_bulk(
    files: list[UploadFile] = File(...),
    x_user_id: Optional[str] = Header(default=None),
) -> dict[str, Any]:
    """Bulk conversion (P4): submit several PDFs, one job each.

    Each file is validated independently; per-file failures are reported
    inline without aborting the batch. Quota applies per file.
    """
    if len(files) > config.BULK_MAX_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"Bulk conversion accepts at most {config.BULK_MAX_FILES} files",
        )
    results: list[dict[str, Any]] = []
    for file in files:
        # Validate first so a bad file never consumes quota.
        try:
            pdf_path = validate_and_save(file.file, file.filename)
            check_password(pdf_path)
        except IntakeError as e:
            results.append({"filename": file.filename, "jobId": None, "error": e.detail})
            continue

        if x_user_id:
            allowed, _remaining = QUOTA.check_and_increment(x_user_id)
            if not allowed:
                try:
                    from pathlib import Path
                    Path(pdf_path).unlink()
                except OSError:
                    pass
                results.append({
                    "filename": file.filename, "jobId": None,
                    "error": f"Daily conversion quota exceeded ({QUOTA.limit} docs/day)",
                })
                continue

        job_id = uuid.uuid4().hex
        config.ensure_dirs()
        if STORE.using_redis:
            STORE.save(job_id, {"jobId": job_id, "status": "queued", "progress": 0.0,
                                "filename": file.filename, "userId": x_user_id})
            try:
                STORE.enqueue({"jobId": job_id, "pdfPath": pdf_path,
                               "filename": file.filename, "userId": x_user_id})
            except RuntimeError:
                _local_job(job_id, status="queued", filename=file.filename)
                asyncio.create_task(_run_job_in_process(job_id, pdf_path, file.filename or "upload.pdf"))
        else:
            _local_job(job_id, status="queued", filename=file.filename)
            asyncio.create_task(_run_job_in_process(job_id, pdf_path, file.filename or "upload.pdf"))
        results.append({"filename": file.filename, "jobId": job_id, "error": None})
    METRICS.inc("conversion_bulk_requests_total")
    return {"jobs": results, "count": len(results)}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=config.HOST, port=config.PORT)
