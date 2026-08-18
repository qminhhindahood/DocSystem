"""tests/test_validator.py — schema validator (plan §3 enforcement)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from schema.validator import validate_chunk


def test_valid_chunk_passes():
    data = [
        {"type": "heading", "level": 1, "text": "QUYẾT ĐỊNH", "confidence": 1.0},
        {"type": "paragraph", "text": "Nội dung.", "confidence": 0.9},
    ]
    r = validate_chunk(data)
    assert r.ok and len(r.blocks) == 2


def test_missing_required_confidence_fails():
    data = [{"type": "heading", "level": 1, "text": "X"}]
    r = validate_chunk(data)
    assert not r.ok
    assert "confidence" in r.error_text()


def test_bad_bbox_fails():
    data = [{"type": "image", "kind": "seal", "bbox": [10, 10, 5, 5],
             "confidence": 0.8}]
    r = validate_chunk(data)
    assert not r.ok


def test_empty_paragraph_semantic_fail():
    data = [{"type": "paragraph", "text": "   ", "confidence": 1.0}]
    r = validate_chunk(data)
    assert not r.ok
    assert "no text" in r.error_text()


def test_floating_photo_semantic_fail():
    data = [{"type": "image", "kind": "photo", "placement": "floating",
             "bbox": [10, 10, 100, 100], "confidence": 0.8}]
    r = validate_chunk(data)
    assert not r.ok


def test_unknown_type_fails():
    data = [{"type": "bogus", "confidence": 1.0}]
    r = validate_chunk(data)
    assert not r.ok


def test_wrapped_blocks_key_accepted():
    data = {"blocks": [{"type": "paragraph", "text": "ok", "confidence": 1.0}]}
    r = validate_chunk(data)
    assert r.ok
