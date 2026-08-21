"""Shared upload admission for single and bulk conversion requests."""
from __future__ import annotations

import uuid
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO, Callable, Optional

from ingest.intake import IntakeError
from quota import QuotaCharge, QuotaService
from user_errors import UNEXPECTED_CONVERSION_ERROR


SCANNED_NO_VISION_DETAIL = (
    "Tài liệu có trang quét (scanned) nhưng chưa có khóa API Google Gemini. "
    "Hãy vào Cài đặt (biểu tượng bánh răng ở thanh bên) và cấu hình khóa API "
    "Google Gemini của bạn, sau đó thử lại."
)

logger = logging.getLogger(__name__)


class AdmissionError(Exception):
    """A safe request-level rejection after an upload reaches admission."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class AdmittedJob:
    job_id: str
    pdf_path: str
    filename: str
    user_id: Optional[str]
    vision: Optional[dict[str, Any]]
    quota_charge: Optional[QuotaCharge]

    @property
    def quota_key(self) -> Optional[str]:
        return self.quota_charge.key if self.quota_charge else None

    def state(self) -> dict[str, Any]:
        return {
            "jobId": self.job_id,
            "status": "queued",
            "progress": 0.0,
            "filename": self.filename,
            "userId": self.user_id,
            "quotaKey": self.quota_key,
        }

    def payload(self) -> dict[str, Any]:
        return {
            **self.state(),
            "pdfPath": self.pdf_path,
            "vision": self.vision,
        }


def delete_source(pdf_path: Optional[str]) -> bool:
    """Delete one admitted upload, logging retention failures for follow-up."""
    if not pdf_path:
        return True
    try:
        Path(pdf_path).unlink(missing_ok=True)
        return True
    except OSError as error:
        logger.error("could not delete rejected source %s: %s", pdf_path, error)
        return False


def admit_upload(
    fileobj: BinaryIO,
    filename: Optional[str],
    user_id: Optional[str],
    vision: Optional[dict[str, Any]],
    quota: QuotaService,
    *,
    validate: Callable[[BinaryIO, Optional[str]], str],
    password_check: Callable[[str], None],
    scanned_detector: Callable[[str], bool],
) -> AdmittedJob:
    """Validate, gate, charge, and return one owner-scoped job context."""
    pdf_path: Optional[str] = None
    charge: Optional[QuotaCharge] = None
    try:
        pdf_path = validate(fileobj, filename)
        password_check(pdf_path)
        if vision is None and scanned_detector(pdf_path):
            raise AdmissionError(422, SCANNED_NO_VISION_DETAIL)
        if user_id:
            charge, _remaining = quota.charge(user_id)
            if charge is None:
                raise AdmissionError(
                    429,
                    f"Daily conversion quota exceeded ({quota.limit} docs/day)",
                )
        return AdmittedJob(
            job_id=uuid.uuid4().hex,
            pdf_path=pdf_path,
            filename=filename or "upload.pdf",
            user_id=user_id,
            vision=vision,
            quota_charge=charge,
        )
    except (IntakeError, AdmissionError):
        delete_source(pdf_path)
        raise
    except Exception as error:
        delete_source(pdf_path)
        raise AdmissionError(500, UNEXPECTED_CONVERSION_ERROR) from error
