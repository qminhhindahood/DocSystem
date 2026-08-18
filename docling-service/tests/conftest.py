"""Test fixtures for docling-service."""
import os
import tempfile

import pytest
from fastapi.testclient import TestClient

_test_upload_dir = tempfile.TemporaryDirectory(prefix="docai-docling-tests-")
os.environ.setdefault("DOCLING_UPLOAD_DIR", _test_upload_dir.name)

from main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def sample_pdf_bytes():
    """Minimal valid PDF (empty page, 1 page)."""
    return (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n"
        b"xref\n"
        b"0 4\n"
        b"0000000000 65535 f \n"
        b"0000000009 00000 n \n"
        b"0000000058 00000 n \n"
        b"0000000115 00000 n \n"
        b"trailer<</Size 4/Root 1 0 R>>\n"
        b"startxref\n"
        b"190\n"
        b"%%EOF"
    )
