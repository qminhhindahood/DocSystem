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
from contextlib import asynccontextmanager, suppress
from dataclasses import asdict
from pathlib import Path
from typing import Any, Optional

import json

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse

import config
from admission import (
    SCANNED_NO_VISION_DETAIL,
    AdmissionError,
    AdmittedJob,
    admit_upload,
    delete_source,
)
from artifact_cleanup import (
    cleanup_expired_artifacts,
    delete_job_artifacts,
    mark_job_artifacts_complete,
)
from ingest.intake import IntakeError, check_password, open_document, validate_and_save
from job_store import JobStore
from metrics import METRICS
from pipeline import convert_pdf
from quota import QuotaService
from triage.triage import SCANNED, triage_page
from user_errors import UNEXPECTED_CONVERSION_ERROR, VISION_AUTH_FAILED_DETAIL
from vision.gemini_contract import VisionAuthError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def _artifact_cleanup_loop() -> None:
    while True:
        await asyncio.sleep(config.FILE_CLEANUP_INTERVAL_S)
        await asyncio.to_thread(cleanup_expired_artifacts)


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    cleanup_task = asyncio.create_task(_artifact_cleanup_loop())
    try:
        yield
    finally:
        cleanup_task.cancel()
        with suppress(asyncio.CancelledError):
            await cleanup_task


app = FastAPI(
    title="Conversion Service", version=config.SERVICE_VERSION, lifespan=_lifespan
)

# Job state: Redis-backed when reachable, in-memory otherwise.
STORE = JobStore()
QUOTA = QuotaService(redis_client=STORE.redis_client)

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


# ─── BYOK vision (scanned pages) ──────────────────────────────────────────────
# The backend attaches the submitting user's decrypted Gemini config as a JSON
# form field. The server itself holds no vision key: a scanned upload without
# one is rejected up front (422) BEFORE quota is charged, with instructions.

def _parse_vision(raw: Optional[str]) -> Optional[dict[str, Any]]:
    """Decode the optional 'vision' form field. Invalid input -> absent."""
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(parsed, dict):
        return None
    provider = parsed.get("provider")
    model = parsed.get("model")
    api_key = parsed.get("apiKey")
    if provider != "gemini" or not isinstance(model, str) or not model:
        return None
    if not isinstance(api_key, str) or not api_key:
        return None
    return {"provider": "gemini", "model": model, "apiKey": api_key}


def _has_scanned_pages(pdf_path: str) -> bool:
    """Triage pass over the saved PDF: True when any page is SCANNED.

    Runs before quota so a keyless scanned upload is rejected free. The
    pipeline re-triages during conversion; this pass only gates admission.
    """
    doc = open_document(pdf_path)
    try:
        for idx in range(len(doc)):
            if triage_page(doc[idx]) == SCANNED:
                return True
        return False
    finally:
        doc.close()


def _record_job_metrics(report) -> None:
    METRICS.inc("conversion_jobs_total", status=report.status)
    for ptype, count in report.page_types.items():
        METRICS.inc("conversion_pages_total", type=ptype, value=float(count))
    METRICS.inc("conversion_degraded_pages_total", value=float(len(report.degraded_pages)))
    METRICS.observe_duration(report.timings.get("total_s", 0.0))
    METRICS.observe_confidence(report.confidence)
    METRICS.record_outcome(report.status)


def _refund_local_once(job: AdmittedJob) -> None:
    """Refund one failed local job using the charge captured at admission."""
    state = _LOCAL_JOBS.get(job.job_id) or {}
    if not job.user_id or not job.quota_key or state.get("quotaRefunded"):
        return
    refund_key = f"{config.JOB_STATE_PREFIX}{job.job_id}:refunded"
    try:
        QUOTA.refund_charge_once(
            refund_key,
            job.quota_key,
            ttl_s=config.JOB_STATE_TTL_S,
        )
    except Exception as error:  # noqa: BLE001
        logger.warning("quota refund failed for local job %s: %s", job.job_id, error)
        return
    _local_job(job.job_id, quotaRefunded=True)


async def _run_job_in_process(job: AdmittedJob) -> None:
    _local_job(job.job_id, **{**job.state(), "status": "processing", "progress": 0.1})
    out_path = str(config.OUTPUT_DIR / f"{job.job_id}.docx")
    try:
        _local_job(job.job_id, progress=0.3)
        docx_path, report = await asyncio.to_thread(
            convert_pdf,
            job.pdf_path,
            out_path,
            str(config.MEDIA_DIR / job.job_id),
            job.vision,
        )
        _local_job(job.job_id, progress=1.0)
        _record_job_metrics(report)
        if report.status == "failed":
            _local_job(job.job_id, status="failed", report=asdict(report))
            delete_job_artifacts(job.job_id)
            _refund_local_once(job)
        else:
            mark_job_artifacts_complete(job.job_id)
            _local_job(job.job_id, status=report.status, resultUrl=f"/convert/{job.job_id}/result",
                       confidence=round(report.confidence, 3),
                       degradedPages=report.degraded_pages, report=asdict(report))
    except IntakeError as e:
        METRICS.inc("conversion_jobs_total", status="failed")
        METRICS.record_outcome("failed")
        _local_job(job.job_id, status="failed", error=e.detail)
        delete_job_artifacts(job.job_id)
        _refund_local_once(job)
    except VisionAuthError:
        logger.exception("conversion job %s rejected the Gemini key", job.job_id)
        METRICS.inc("conversion_jobs_total", status="failed")
        METRICS.record_outcome("failed")
        _local_job(job.job_id, status="failed", error=VISION_AUTH_FAILED_DETAIL)
        delete_job_artifacts(job.job_id)
        _refund_local_once(job)
    except Exception:  # noqa: BLE001
        logger.exception("conversion job %s failed", job.job_id)
        METRICS.inc("conversion_jobs_total", status="failed")
        METRICS.record_outcome("failed")
        _local_job(job.job_id, status="failed", error=UNEXPECTED_CONVERSION_ERROR)
        delete_job_artifacts(job.job_id)
        _refund_local_once(job)
    finally:
        delete_source(job.pdf_path)


def _admit_upload(
    file: UploadFile,
    user_id: Optional[str],
    vision: Optional[dict[str, Any]],
) -> AdmittedJob:
    return admit_upload(
        file.file,
        file.filename,
        user_id,
        vision,
        QUOTA,
        validate=validate_and_save,
        password_check=check_password,
        scanned_detector=_has_scanned_pages,
    )


def _dispatch_job(job: AdmittedJob) -> str:
    """Persist and dispatch one admitted job through queue or local mode."""
    try:
        config.ensure_dirs()
        state = job.state()
        if STORE.using_redis:
            STORE.save(job.job_id, state)
            try:
                STORE.enqueue(job.payload())
                return "queue"
            except RuntimeError:
                pass

        _local_job(job.job_id, **state)
        coroutine = _run_job_in_process(job)
        try:
            asyncio.create_task(coroutine)
        except Exception:
            coroutine.close()
            raise
        return "in-process"
    except Exception as error:
        logger.exception("conversion job %s could not be dispatched", job.job_id)
        try:
            STORE.delete(job.job_id)
        except Exception as cleanup_error:  # noqa: BLE001
            logger.error(
                "job state cleanup failed for undispatched job %s: %s",
                job.job_id,
                cleanup_error,
            )
        _LOCAL_JOBS.pop(job.job_id, None)
        if job.quota_key:
            try:
                QUOTA.refund_charge_once(
                    f"{config.JOB_STATE_PREFIX}{job.job_id}:refunded",
                    job.quota_key,
                    ttl_s=config.JOB_STATE_TTL_S,
                )
            except Exception as refund_error:  # noqa: BLE001
                logger.error(
                    "quota rollback failed for undispatched job %s: %s",
                    job.job_id,
                    refund_error,
                )
        delete_source(job.pdf_path)
        raise AdmissionError(500, UNEXPECTED_CONVERSION_ERROR) from error


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
            redis_client = STORE.redis_client
            queue_depth = redis_client.llen(config.CONVERSION_QUEUE_KEY)
            # Aggregate worker-recorded counters (separate process writes to
            # Redis so the API can surface them on a single scrape endpoint).
            for key in redis_client.keys(METRICS.REDIS_METRICS_PREFIX + "*"):
                name = key[len(METRICS.REDIS_METRICS_PREFIX):]
                try:
                    redis_worker[name] = float(redis_client.get(key) or 0)
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
    vision: Optional[str] = Form(default=None),
) -> dict[str, Any]:
    """Accept a PDF upload, start a conversion job, return its jobId."""
    vision_config = _parse_vision(vision)
    try:
        job = _admit_upload(file, x_user_id, vision_config)
        mode = _dispatch_job(job)
    except (IntakeError, AdmissionError) as error:
        raise HTTPException(status_code=error.status_code, detail=error.detail)
    return {"jobId": job.job_id, "mode": mode}


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
        # Owning user — the backend owner-scopes reads against it (ticket 03).
        "userId": job.get("userId"),
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
        "coverage": report.get("coverage"),
        "degradedPages": job.get("degradedPages", []),
        "userId": job.get("userId"),
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
    vision: Optional[str] = Form(default=None),
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
    vision_config = _parse_vision(vision)
    results: list[dict[str, Any]] = []
    for file in files:
        try:
            job = _admit_upload(file, x_user_id, vision_config)
            _dispatch_job(job)
        except (IntakeError, AdmissionError) as error:
            results.append({
                "filename": file.filename,
                "jobId": None,
                "error": error.detail,
            })
            continue
        results.append({"filename": file.filename, "jobId": job.job_id, "error": None})
    METRICS.inc("conversion_bulk_requests_total")
    return {"jobs": results, "count": len(results)}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=config.HOST, port=config.PORT)
