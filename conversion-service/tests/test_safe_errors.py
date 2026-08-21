"""Unexpected conversion failures expose a stable safe user contract."""
from __future__ import annotations

import asyncio

import fakeredis

import config
import main
import worker
from job_store import JobStore
from vision.gemini_contract import VisionAuthError


SAFE_ERROR = "Không thể chuyển đổi tệp này. Vui lòng kiểm tra PDF và thử lại."


def _configure_artifacts(monkeypatch, tmp_path):
    output_dir = tmp_path / "outputs"
    media_dir = tmp_path / "media"
    output_dir.mkdir()
    media_dir.mkdir()
    monkeypatch.setattr(config, "OUTPUT_DIR", output_dir)
    monkeypatch.setattr(config, "MEDIA_DIR", media_dir)


def test_worker_stores_safe_message_for_unexpected_failure(monkeypatch, tmp_path):
    _configure_artifacts(monkeypatch, tmp_path)
    store = JobStore(redis_client=fakeredis.FakeRedis(decode_responses=True))
    source = tmp_path / "worker.pdf"
    source.write_bytes(b"%PDF-1.4")
    job = {"jobId": "safe-worker", "pdfPath": str(source), "userId": None}
    store.save("safe-worker", {"jobId": "safe-worker", "status": "queued"})

    def crash(*args, **kwargs):
        raise RuntimeError(r"secret parser path C:\private\document.pdf")

    monkeypatch.setattr(worker, "convert_pdf", crash)

    worker.process_job(store, job)

    state = store.load("safe-worker")
    assert state["error"] == SAFE_ERROR
    assert "private" not in state["error"]


def test_in_process_runner_stores_safe_message_for_unexpected_failure(
    monkeypatch, tmp_path
):
    _configure_artifacts(monkeypatch, tmp_path)
    source = tmp_path / "local.pdf"
    source.write_bytes(b"%PDF-1.4")
    main._LOCAL_JOBS.pop("safe-local", None)

    def crash(*args, **kwargs):
        raise RuntimeError("upstream secret response")

    monkeypatch.setattr(main, "convert_pdf", crash)

    asyncio.run(main._run_job_in_process("safe-local", str(source), "local.pdf"))

    assert main._LOCAL_JOBS["safe-local"]["error"] == SAFE_ERROR


def test_in_process_runner_preserves_gemini_auth_message(monkeypatch, tmp_path):
    _configure_artifacts(monkeypatch, tmp_path)
    source = tmp_path / "auth.pdf"
    source.write_bytes(b"%PDF-1.4")
    main._LOCAL_JOBS.pop("auth-local", None)

    def reject_key(*args, **kwargs):
        raise VisionAuthError("provider detail must not escape")

    monkeypatch.setattr(main, "convert_pdf", reject_key)

    asyncio.run(main._run_job_in_process("auth-local", str(source), "auth.pdf"))

    assert main._LOCAL_JOBS["auth-local"]["error"] == worker.VISION_AUTH_FAILED_DETAIL
