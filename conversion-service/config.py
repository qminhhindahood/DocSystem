"""conversion-service configuration — env loading + constants.

All thresholds come from CONVERSION_SERVICE_PLAN.md (§4 triage, §10 confidence,
§11 degradation). Secrets only via env; never hardcoded, never logged.
"""
from __future__ import annotations

import os
from pathlib import Path

# ─── Paths ────────────────────────────────────────────────────────────────────
SERVICE_DIR = Path(__file__).resolve().parent
REPO_ROOT = SERVICE_DIR.parent
SHARED_TYPOGRAPHY_PATH = Path(
    os.environ.get("DECREE30_TYPOGRAPHY_PATH", REPO_ROOT / "shared" / "decree30-typography.json")
)
WORK_DIR = Path(os.environ.get("CONVERSION_WORK_DIR", SERVICE_DIR / "work"))
UPLOAD_DIR = WORK_DIR / "uploads"
OUTPUT_DIR = WORK_DIR / "outputs"
MEDIA_DIR = WORK_DIR / "media"

# ─── Service ──────────────────────────────────────────────────────────────────
SERVICE_NAME = "conversion-service"
SERVICE_VERSION = "0.1.0"
HOST = os.environ.get("CONVERSION_HOST", "0.0.0.0")
PORT = int(os.environ.get("CONVERSION_PORT", "8004"))

# ─── Upload validation (mirrors docling-service) ─────────────────────────────
MAX_FILE_SIZE = int(os.environ.get("CONVERSION_MAX_FILE_MB", "50")) * 1024 * 1024
PDF_MAGIC = b"%PDF-"

# ─── Triage thresholds (plan §4) ──────────────────────────────────────────────
FULLPAGE_IMAGE_COVERAGE = 0.70      # raster covering >= 70% of page area
SCANNED_TEXT_SLIVER_CHARS = 150     # full-page image + < 150 chars of text -> scanned
MIN_TRUSTED_LETTERS = 50            # fewer letters than this -> vision path
DIACRITIC_RATIO_MIN = 0.05          # healthy VN prose carries ~20-40% diacritics
REPLACEMENT_RATIO_MAX = 0.02        # U+FFFD ratio above this -> corrupted layer
TABLE_CELL_FILL_MIN = 0.70          # find_tables quality gate: non-empty cells / total
TABLE_MIN_COLUMNS = 2               # find_tables quality gate: >= 2 columns

# ─── Zone geometry (plan §4 / §5) ─────────────────────────────────────────────
HEADER_ZONE_RATIO = 0.25            # top ~25% -> admin_header zone
SIGNATURE_ZONE_RATIO = 0.25         # bottom ~25% -> signature zone

# ─── Gemini vision (plan §6) ──────────────────────────────────────────────────
GEMINI_MODEL = os.environ.get("CONVERSION_GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_BATCH_PAGES = 8              # up to 8 pages per call
GEMINI_PARALLEL_CALLS = int(os.environ.get("CONVERSION_GEMINI_PARALLEL", "4"))  # 4-8
GEMINI_TEMPERATURE = 0.0            # transcription must be deterministic
GEMINI_TIMEOUT_S = float(os.environ.get("CONVERSION_GEMINI_TIMEOUT_S", "120"))

def gemini_api_key() -> str | None:
    """Gemini key from env only. Never hardcoded, never logged."""
    return os.environ.get("GEMINI_API_KEY")

# ─── Confidence (plan §10) ────────────────────────────────────────────────────
BLOCK_REVIEW_THRESHOLD = 0.6        # block < 0.6 -> flag for review
PAGE_REVIEW_THRESHOLD = 0.7         # page avg < 0.7 -> flag page
DOC_WARN_THRESHOLD = 0.8            # doc avg < 0.8 -> warn user on delivery
SCANNED_CONFIDENCE_CAP = 0.95       # scanned extraction capped even with LLM boost

# ─── Degradation (plan §11) ───────────────────────────────────────────────────
CHUNK_MAX_RETRIES = 2               # per-chunk retries with validation error feedback
FAILED_PAGE_RATIO = 0.30            # > 30% pages degraded -> job failed
COVERAGE_WARN_THRESHOLD = 0.60      # output chars < 60% of extracted -> warn

# ─── Bulk conversion (P4) ─────────────────────────────────────────────────────
BULK_MAX_FILES = int(os.environ.get("CONVERSION_BULK_MAX_FILES", "10"))

# ─── Redis queue (P3, plan §8) ────────────────────────────────────────────────
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
CONVERSION_QUEUE_KEY = "conversion_queue"
JOB_STATE_PREFIX = "conversion:job:"
JOB_STATE_TTL_S = int(os.environ.get("CONVERSION_JOB_TTL_S", str(24 * 3600)))  # file TTL
FILE_TTL_S = int(os.environ.get("CONVERSION_FILE_TTL_S", str(24 * 3600)))      # auto-delete
QUEUE_POLL_TIMEOUT_S = 1  # BLPOP block time

# ─── Eval targets (plan §12) ──────────────────────────────────────────────────
EVAL_CER_DIGITAL_MAX = 0.02
EVAL_CER_SCANNED_MAX = 0.05
EVAL_BLOCK_F1_MIN = 0.95
EVAL_SEAL_RECALL_MIN = 1.0
EVAL_HALLUCINATION_MAX = 0.0


def ensure_dirs() -> None:
    for d in (UPLOAD_DIR, OUTPUT_DIR, MEDIA_DIR):
        d.mkdir(parents=True, exist_ok=True)
