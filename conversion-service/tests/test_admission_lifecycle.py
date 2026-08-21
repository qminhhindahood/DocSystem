"""Admission owns saved sources until a conversion job is dispatched."""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main
from ingest.intake import IntakeError
from quota import QuotaService


def _saved_pdf(tmp_path: Path, name: str = "saved.pdf") -> Path:
    source = tmp_path / name
    source.write_bytes(b"%PDF-1.4 saved")
    return source


def _quota_count(quota: QuotaService, user_id: str) -> int:
    key = quota._key(user_id)
    return quota._memory.get(key, (0, 0.0))[0]


def test_single_password_rejection_deletes_saved_source_and_costs_no_quota(
    monkeypatch, tmp_path
):
    source = _saved_pdf(tmp_path)
    quota = QuotaService(redis_client=None, limit=3)
    monkeypatch.setattr(main, "QUOTA", quota)
    monkeypatch.setattr(main, "validate_and_save", lambda *_args: str(source))

    def reject_password(_path: str) -> None:
        raise IntakeError(422, "locked")

    monkeypatch.setattr(main, "check_password", reject_password)

    with TestClient(main.app) as client:
        response = client.post(
            "/convert",
            headers={"X-User-Id": "admission-user"},
            files={"file": ("locked.pdf", b"%PDF-", "application/pdf")},
        )

    assert response.status_code == 422
    assert not source.exists()
    assert _quota_count(quota, "admission-user") == 0


def test_single_inspection_crash_deletes_saved_source_and_costs_no_quota(
    monkeypatch, tmp_path
):
    source = _saved_pdf(tmp_path)
    quota = QuotaService(redis_client=None, limit=3)
    monkeypatch.setattr(main, "QUOTA", quota)
    monkeypatch.setattr(main, "validate_and_save", lambda *_args: str(source))
    monkeypatch.setattr(main, "check_password", lambda _path: None)
    monkeypatch.setattr(
        main,
        "_has_scanned_pages",
        lambda _path: (_ for _ in ()).throw(RuntimeError("inspection crashed")),
    )

    with TestClient(main.app, raise_server_exceptions=False) as client:
        response = client.post(
            "/convert",
            headers={"X-User-Id": "inspection-user"},
            files={"file": ("broken.pdf", b"%PDF-", "application/pdf")},
        )

    assert response.status_code == 500
    assert not source.exists()
    assert _quota_count(quota, "inspection-user") == 0


def test_bulk_password_rejection_deletes_each_saved_source(
    monkeypatch, tmp_path
):
    source = _saved_pdf(tmp_path, "bulk-saved.pdf")
    quota = QuotaService(redis_client=None, limit=3)
    monkeypatch.setattr(main, "QUOTA", quota)
    monkeypatch.setattr(main, "validate_and_save", lambda *_args: str(source))

    def reject_password(_path: str) -> None:
        raise IntakeError(422, "locked")

    monkeypatch.setattr(main, "check_password", reject_password)

    with TestClient(main.app) as client:
        response = client.post(
            "/convert/bulk",
            headers={"X-User-Id": "bulk-user"},
            files=[("files", ("locked.pdf", b"%PDF-", "application/pdf"))],
        )

    assert response.status_code == 200
    assert response.json()["jobs"][0]["jobId"] is None
    assert not source.exists()
    assert _quota_count(quota, "bulk-user") == 0


def test_single_and_bulk_dispatch_the_same_owner_scoped_charge_context(
    monkeypatch, tmp_path
):
    sources = [
        _saved_pdf(tmp_path, "single.pdf"),
        _saved_pdf(tmp_path, "bulk.pdf"),
    ]
    quota = QuotaService(redis_client=None, limit=3)
    monkeypatch.setattr(main, "QUOTA", quota)

    class LocalStore:
        using_redis = False

        @staticmethod
        def load(_job_id):
            return None

    monkeypatch.setattr(main, "STORE", LocalStore())
    monkeypatch.setattr(
        main, "validate_and_save", lambda *_args: str(sources.pop(0))
    )
    monkeypatch.setattr(main, "check_password", lambda _path: None)
    monkeypatch.setattr(main, "_has_scanned_pages", lambda _path: False)

    async def leave_queued(*_args, **_kwargs):
        return None

    monkeypatch.setattr(main, "_run_job_in_process", leave_queued)
    main._LOCAL_JOBS.clear()

    with TestClient(main.app) as client:
        single = client.post(
            "/convert",
            headers={"X-User-Id": "context-user"},
            files={"file": ("single.pdf", b"%PDF-", "application/pdf")},
        )
        bulk = client.post(
            "/convert/bulk",
            headers={"X-User-Id": "context-user"},
            files=[("files", ("bulk.pdf", b"%PDF-", "application/pdf"))],
        )

    job_ids = [single.json()["jobId"], bulk.json()["jobs"][0]["jobId"]]
    expected_key = quota._key("context-user")
    for job_id in job_ids:
        state = main._LOCAL_JOBS[job_id]
        assert state["userId"] == "context-user"
        assert state["quotaKey"] == expected_key
