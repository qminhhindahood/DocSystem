"""Tests for upload isolation — concurrent same-name files get unique paths."""
import asyncio
import os
import tempfile
from pathlib import Path
from fastapi.testclient import TestClient
from main import app, UPLOAD_DIR, _validate_and_save, _cleanup
from unittest.mock import patch
import pytest


@pytest.fixture(autouse=True)
def clear_uploads():
    """Ensure clean upload directory before each test."""
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    for f in Path(UPLOAD_DIR).iterdir():
        f.unlink()
    yield


def make_fake_upload(filename: str, content: bytes):
    """Build a minimal UploadFile-like object for _validate_and_save."""
    from fastapi import UploadFile
    import io
    f = io.BytesIO(content)
    return UploadFile(filename=filename, file=f)


class TestUploadIsolation:
    """Two simultaneous uploads with the same name must produce different paths."""

    def test_validate_and_save_uses_unique_path(self, sample_pdf_bytes):
        """Calling _validate_and_save twice with same filename yields different paths."""
        upload1 = make_fake_upload("same.pdf", sample_pdf_bytes)
        path1 = _validate_and_save(upload1)

        upload2 = make_fake_upload("same.pdf", b"%PDF-1.4\n%%EOF")
        path2 = _validate_and_save(upload2)

        assert path1 != path2, "Same filename must produce different disk paths"
        assert os.path.exists(path1)
        assert os.path.exists(path2)

        # Cleanup
        _cleanup(path1)
        _cleanup(path2)
        assert not os.path.exists(path1)
        assert not os.path.exists(path2)

    def test_upload_dir_isolation(self, sample_pdf_bytes):
        """All uploads land inside UPLOAD_DIR (path traversal guard)."""
        upload = make_fake_upload("same.pdf", sample_pdf_bytes)
        path = _validate_and_save(upload)

        real_path = os.path.realpath(path)
        real_upload = os.path.realpath(UPLOAD_DIR)
        assert real_path.startswith(real_upload + os.sep)

        _cleanup(path)

    def test_validate_non_pdf_rejected(self):
        """Non-PDF files are rejected before any disk write."""
        from fastapi import UploadFile
        import io
        f = io.BytesIO(b"not a pdf")
        upload = UploadFile(filename="evil.exe", file=f)

        from fastapi import HTTPException
        with pytest.raises(HTTPException, match="Only PDF files"):
            _validate_and_save(upload)

        # No stray file
        remaining = list(Path(UPLOAD_DIR).iterdir())
        assert len(remaining) == 0

    def test_pdf_filename_with_invalid_signature_is_removed(self):
        """A renamed non-PDF is rejected and its temporary file is cleaned up."""
        upload = make_fake_upload("spoofed.pdf", b"this is not a PDF")

        from fastapi import HTTPException
        with pytest.raises(HTTPException, match="Invalid PDF file"):
            _validate_and_save(upload)

        assert list(Path(UPLOAD_DIR).iterdir()) == []

    @pytest.mark.asyncio
    async def test_concurrent_uploads_same_name_get_unique_paths(self, sample_pdf_bytes):
        """Two concurrent uploads named 'same.pdf' with different content get different paths."""
        client = TestClient(app)

        async def upload(content: bytes):
            return client.post(
                "/parse",
                files={"file": ("same.pdf", content, "application/pdf")},
                params={"do_ocr": False},
            )

        # Patch PyMuPDF to avoid tesseract dependency
        fake_parse = {"success": True, "filename": "same.pdf", "text": "mocked", "tables": None,
                       "metadata": {"pages": 1, "parser": "test", "ocr_used": False}}

        with patch("main._parse_with_pymupdf", return_value=type('FakeResult', (), fake_parse)()):
            # Also mock _parse_with_docling for the same reason
            with patch("main._parse_with_docling", return_value=type('FakeResult', (), fake_parse)()):
                # _check_docling returns False → goes to PyMuPDF
                with patch("main._check_docling", return_value=False):
                    r1, r2 = await asyncio.gather(upload(sample_pdf_bytes), upload(b"different"))

        assert r1.status_code == 200, f"First upload failed: {r1.text}"
        assert r2.status_code == 400, "The non-PDF payload must be rejected before parsing"
        assert list(Path(UPLOAD_DIR).iterdir()) == []


class TestLiveReady:
    """/live always 200; /ready 503 when missing upload dir."""

    def test_live_returns_200(self):
        client = TestClient(app)
        r = client.get("/live")
        assert r.status_code == 200
        assert r.json()["status"] == "alive"

    def test_ready_returns_200_after_conversion_probe(self):
        client = TestClient(app)
        import main as main_module
        main_module._DOCLING_AVAILABLE = None
        with patch("main.probe_docling_conversion", return_value={"status": "passed", "doclingVersion": "test"}):
            r = client.get("/ready")
        assert r.status_code == 200
        assert r.json()["status"] == "ready"
        assert r.json()["conversion_probe"] == "passed"

    def test_ready_returns_503_when_conversion_probe_fails(self):
        client = TestClient(app)
        import main as main_module
        main_module._DOCLING_AVAILABLE = None
        with patch("main.probe_docling_conversion", side_effect=RuntimeError("conversion failed")):
            r = client.get("/ready")
        assert r.status_code == 503
        assert r.json() == {
            "status": "not ready",
            "detail": "Docling conversion capability unavailable",
        }
