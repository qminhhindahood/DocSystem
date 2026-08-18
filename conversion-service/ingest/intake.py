"""ingest/intake.py — upload validation (plan §7 stage 1).

Mirrors the docling-service pattern: extension check, size limit, unique
tempfile, path-traversal guard, PDF magic-byte check. Plus Option A:
password-protected PDFs are rejected here with a friendly 422.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path
from typing import BinaryIO, Optional

import config


class IntakeError(Exception):
    """Validation failure with an HTTP status code."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _secure_filename(name: str) -> str:
    """Minimal secure_filename (no werkzeug dependency in this service)."""
    keep = "-_.()"
    out = []
    for ch in name:
        if ch.isalnum() or ch in keep:
            out.append(ch)
        elif ch in "/\\":
            out.append("_")
    cleaned = "".join(out).strip("._")
    return cleaned or "upload.pdf"


def validate_and_save(fileobj: BinaryIO, filename: Optional[str]) -> str:
    """Validate an upload and persist it; return the absolute path.

    Raises IntakeError(400/413/422) on failure.
    """
    if not filename or not filename.lower().endswith(".pdf"):
        raise IntakeError(400, "Only PDF files are allowed")

    # size limit
    fileobj.seek(0, 2)
    size = fileobj.tell()
    fileobj.seek(0)
    if size > config.MAX_FILE_SIZE:
        mb = config.MAX_FILE_SIZE // (1024 * 1024)
        raise IntakeError(413, f"File size exceeds maximum limit of {mb}MB")

    config.ensure_dirs()
    suffix = Path(_secure_filename(filename)).suffix.lower() or ".pdf"
    if suffix != ".pdf":
        suffix = ".pdf"

    fd, tmp_path = tempfile.mkstemp(prefix="conv_", suffix=suffix,
                                    dir=str(config.UPLOAD_DIR))
    try:
        with os.fdopen(fd, "wb") as target:
            shutil.copyfileobj(fileobj, target)
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise IntakeError(400, "Unable to store uploaded file")

    # path traversal guard
    real_path = os.path.realpath(tmp_path)
    real_upload = os.path.realpath(str(config.UPLOAD_DIR))
    if not real_path.startswith(real_upload + os.sep) and real_path != real_upload:
        os.remove(tmp_path)
        raise IntakeError(400, "Invalid file path")

    # magic bytes (read, close, THEN remove — Windows cannot delete open files)
    try:
        with open(tmp_path, "rb") as f:
            head = f.read(5)
    except OSError as e:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise IntakeError(400, "Unable to validate PDF file") from e
    if head != config.PDF_MAGIC:
        os.remove(tmp_path)
        raise IntakeError(400, "Invalid PDF file")

    return tmp_path


def check_password(path: str) -> None:
    """Option A (plan §7): reject pre-locked PDFs with a friendly 422.

    This locks nothing — it only detects files already locked by their
    creator with an *open* password (unreadable to us). Permission-only
    encryption (needs_pass == False) proceeds normally.
    """
    import pymupdf

    try:
        doc = pymupdf.open(path)
    except Exception as e:
        raise IntakeError(422, "Unable to open PDF file") from e
    try:
        if doc.needs_pass:
            raise IntakeError(
                422,
                "Password-protected PDFs are not supported. "
                "Please remove the password and re-upload.",
            )
    finally:
        doc.close()


def open_document(path: str):
    """Open a validated PDF for processing."""
    import pymupdf

    return pymupdf.open(path)
