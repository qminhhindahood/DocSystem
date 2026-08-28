"""Contracts for the typography sync guard (comprehensive review remediation).

The guard (scripts/check_typography_sync.py) must validate the canonical
shared/decree30-typography.json and its remaining runtime consumer, the
Python rule engine. The deleted TypeScript generation consumer
(backend/src/services/template_typography_rules.ts) must no longer be
referenced. The release preflight (eval/preflight.py) runs the same guard
and must pass.
"""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = SERVICE_ROOT.parent
GUARD_SCRIPT = SERVICE_ROOT / "scripts" / "check_typography_sync.py"


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_guard_passes_on_the_canonical_repository():
    proc = subprocess.run(
        [sys.executable, str(GUARD_SCRIPT)], capture_output=True, text=True, timeout=120
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "TYPOGRAPHY SYNC: PASS" in proc.stdout


def test_guard_no_longer_references_the_deleted_typescript_consumer():
    source = GUARD_SCRIPT.read_text(encoding="utf-8")
    assert "template_typography_rules" not in source
    assert "ROLE_RULES" not in source


def test_guard_fails_on_corrupted_canonical_json(tmp_path, monkeypatch):
    guard = _load_module("check_typography_sync_corrupt", GUARD_SCRIPT)
    broken = tmp_path / "decree30-typography.json"
    broken.write_text("{ not json", encoding="utf-8")
    monkeypatch.setattr(guard, "SHARED", broken)
    assert guard.main() == 1


def test_guard_fails_when_a_required_key_is_missing(tmp_path, monkeypatch):
    guard = _load_module("check_typography_sync_missing_key", GUARD_SCRIPT)
    canonical = json.loads((REPO_ROOT / "shared" / "decree30-typography.json").read_text(encoding="utf-8"))
    del canonical["roles"]
    stripped = tmp_path / "decree30-typography.json"
    stripped.write_text(json.dumps(canonical), encoding="utf-8")
    monkeypatch.setattr(guard, "SHARED", stripped)
    assert guard.main() == 1


def test_preflight_typography_checks_pass():
    preflight = _load_module("preflight_typography", SERVICE_ROOT / "eval" / "preflight.py")
    preflight.results.clear()
    preflight.check_typography()
    preflight.check_typography_sync()
    recorded = {check: status for check, status, _detail in preflight.results}
    assert recorded.get("typography JSON") == "PASS", recorded
    assert recorded.get("typography sync") == "PASS", recorded
