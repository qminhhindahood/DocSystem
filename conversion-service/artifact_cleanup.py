"""Retention lifecycle for job-scoped DOCX results and extracted media."""
from __future__ import annotations

import logging
import shutil
import time
from pathlib import Path
from typing import Optional

import config

logger = logging.getLogger(__name__)


def _job_path(root: Path, name: str) -> Path:
    if not name or Path(name).name != name or name in (".", ".."):
        raise ValueError("job_id must be a single path component")
    resolved_root = root.resolve()
    candidate = (resolved_root / name).resolve()
    if candidate.parent != resolved_root:
        raise ValueError("job artifact escaped its configured root")
    return candidate


def _paths(job_id: str) -> tuple[Path, Path]:
    return (
        _job_path(config.OUTPUT_DIR, f"{job_id}.docx"),
        _job_path(config.MEDIA_DIR, job_id),
    )


def mark_job_artifacts_complete(job_id: str) -> None:
    """Start the file-retention clock at terminal conversion completion."""
    for path in _paths(job_id):
        try:
            if path.exists():
                path.touch()
        except OSError as exc:
            logger.warning("could not timestamp artifact %s: %s", path, exc)


def delete_job_artifacts(job_id: str) -> int:
    """Delete one job's exact DOCX and media directory; return paths removed."""
    output_path, media_path = _paths(job_id)
    removed = 0
    try:
        if output_path.exists():
            output_path.unlink()
            removed += 1
    except OSError as exc:
        logger.warning("could not delete result %s: %s", output_path, exc)
    try:
        if media_path.is_dir():
            shutil.rmtree(media_path)
            removed += 1
    except OSError as exc:
        logger.warning("could not delete media %s: %s", media_path, exc)
    return removed


def _expired(path: Path, cutoff: float) -> bool:
    try:
        return path.stat().st_mtime <= cutoff
    except OSError:
        return False


def cleanup_expired_artifacts(now: Optional[float] = None) -> int:
    """Remove direct job artifacts older than FILE_TTL_S; return path count."""
    cutoff = (time.time() if now is None else now) - config.FILE_TTL_S
    removed = 0
    if config.OUTPUT_DIR.is_dir():
        try:
            output_paths = list(config.OUTPUT_DIR.glob("*.docx"))
        except OSError as exc:
            logger.warning("could not scan result directory %s: %s", config.OUTPUT_DIR, exc)
            output_paths = []
        for output_path in output_paths:
            if not _expired(output_path, cutoff):
                continue
            try:
                output_path.unlink()
                removed += 1
            except FileNotFoundError:
                pass
            except OSError as exc:
                logger.warning("could not expire result %s: %s", output_path, exc)
    if config.MEDIA_DIR.is_dir():
        try:
            media_paths = list(config.MEDIA_DIR.iterdir())
        except OSError as exc:
            logger.warning("could not scan media directory %s: %s", config.MEDIA_DIR, exc)
            media_paths = []
        for media_path in media_paths:
            if not media_path.is_dir() or not _expired(media_path, cutoff):
                continue
            try:
                shutil.rmtree(media_path)
                removed += 1
            except FileNotFoundError:
                pass
            except OSError as exc:
                logger.warning("could not expire media %s: %s", media_path, exc)
    return removed
