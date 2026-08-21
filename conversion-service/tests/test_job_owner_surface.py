"""tests/test_job_owner_surface.py — job owner surfaced on status/report (ticket 03).

Seam: HTTP contract via TestClient. The internal service must expose the
owning user on status and report reads so the backend can owner-scope them.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main
from job_store import JobStore


def test_status_includes_owner():
    main.STORE.save("owner-job-1", {
        "jobId": "owner-job-1", "status": "queued", "progress": 0.0,
        "filename": "doc.pdf", "userId": "owner-u1",
    })
    try:
        from fastapi.testclient import TestClient
        with TestClient(main.app) as client:
            r = client.get("/convert/owner-job-1")
            assert r.status_code == 200
            body = r.json()
            assert body["userId"] == "owner-u1"
    finally:
        main.STORE.save("owner-job-1", {}, ttl=1)


def test_report_includes_owner():
    main.STORE.save("owner-job-2", {
        "jobId": "owner-job-2", "status": "completed", "progress": 1.0,
        "userId": "owner-u2", "report": {},
    })
    try:
        from fastapi.testclient import TestClient
        with TestClient(main.app) as client:
            r = client.get("/convert/owner-job-2/report")
            assert r.status_code == 200
            assert r.json()["userId"] == "owner-u2"
    finally:
        main.STORE.save("owner-job-2", {}, ttl=1)


def test_local_fallback_shadows_stale_queued_store_record(monkeypatch, tmp_path):
    """A Redis-save fallback must expose local progress through every read."""
    store = JobStore(redis_client=None)
    store.save("fallback-job", {
        "jobId": "fallback-job",
        "status": "queued",
        "progress": 0.0,
        "userId": "fallback-owner",
    })
    output_dir = tmp_path / "outputs"
    output_dir.mkdir()
    (output_dir / "fallback-job.docx").write_bytes(b"docx")
    monkeypatch.setattr(main, "STORE", store)
    monkeypatch.setattr(main.config, "OUTPUT_DIR", output_dir)
    main._LOCAL_JOBS["fallback-job"] = {
        "jobId": "fallback-job",
        "status": "completed",
        "progress": 1.0,
        "userId": "fallback-owner",
        "resultUrl": "/convert/fallback-job/result",
        "report": {"coverage": 0.91, "warnings": []},
    }

    try:
        from fastapi.testclient import TestClient
        with TestClient(main.app) as client:
            status = client.get("/convert/fallback-job")
            report = client.get("/convert/fallback-job/report")
            result = client.get("/convert/fallback-job/result")

        assert status.json()["status"] == "completed"
        assert status.json()["userId"] == "fallback-owner"
        assert report.json()["coverage"] == 0.91
        assert result.status_code == 200
    finally:
        main._LOCAL_JOBS.pop("fallback-job", None)
