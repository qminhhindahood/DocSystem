"""Retention behavior for job-scoped uploads, DOCX results, and media."""
from __future__ import annotations

import asyncio
import os

import config
import main
from pipeline import ConversionReport


def _configure_work_dirs(monkeypatch, tmp_path):
    output_dir = tmp_path / "outputs"
    media_dir = tmp_path / "media"
    output_dir.mkdir()
    media_dir.mkdir()
    monkeypatch.setattr(config, "OUTPUT_DIR", output_dir)
    monkeypatch.setattr(config, "MEDIA_DIR", media_dir)
    monkeypatch.setattr(config, "FILE_TTL_S", 60)
    return output_dir, media_dir


def test_in_process_runner_always_removes_source_upload(monkeypatch, tmp_path):
    _configure_work_dirs(monkeypatch, tmp_path)
    source = tmp_path / "uploaded.pdf"
    source.write_bytes(b"%PDF-1.4")
    report = ConversionReport(status="completed", confidence=0.9)
    monkeypatch.setattr(
        main,
        "convert_pdf",
        lambda pdf_path, out_path, media_dir, vision: (out_path, report),
    )

    asyncio.run(main._run_job_in_process("source-cleanup", str(source), "doc.pdf"))

    assert not source.exists()


def test_expiry_sweep_removes_only_old_job_artifacts(monkeypatch, tmp_path):
    output_dir, media_dir = _configure_work_dirs(monkeypatch, tmp_path)
    from artifact_cleanup import cleanup_expired_artifacts

    expired_output = output_dir / "expired.docx"
    expired_output.write_bytes(b"old")
    expired_media = media_dir / "expired"
    expired_media.mkdir()
    (expired_media / "seal.png").write_bytes(b"old")
    fresh_output = output_dir / "fresh.docx"
    fresh_output.write_bytes(b"new")
    fresh_media = media_dir / "fresh"
    fresh_media.mkdir()
    (fresh_media / "seal.png").write_bytes(b"new")
    unrelated = output_dir / "keep.txt"
    unrelated.write_text("not a conversion result", encoding="utf-8")
    os.utime(expired_output, (900, 900))
    os.utime(expired_media, (900, 900))
    os.utime(fresh_output, (960, 960))
    os.utime(fresh_media, (960, 960))

    removed = cleanup_expired_artifacts(now=1000)

    assert removed == 2
    assert not expired_output.exists()
    assert not expired_media.exists()
    assert fresh_output.exists()
    assert fresh_media.exists()
    assert unrelated.exists()


def test_marking_completion_starts_retention_from_completion(monkeypatch, tmp_path):
    output_dir, media_dir = _configure_work_dirs(monkeypatch, tmp_path)
    from artifact_cleanup import mark_job_artifacts_complete

    output = output_dir / "marked.docx"
    output.write_bytes(b"result")
    media = media_dir / "marked"
    media.mkdir()
    os.utime(output, (1, 1))
    os.utime(media, (1, 1))

    mark_job_artifacts_complete("marked")

    assert output.stat().st_mtime > 1
    assert media.stat().st_mtime > 1
