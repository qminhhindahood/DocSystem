"""tests/test_job_owner_surface.py — job owner surfaced on status/report (ticket 03).

Seam: HTTP contract via TestClient. The internal service must expose the
owning user on status and report reads so the backend can owner-scope them.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main


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
