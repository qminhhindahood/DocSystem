"""The TestClient dependency must use the supported path (warning-free).

starlette.testclient prefers httpx2; falling back to httpx emits a
StarletteDeprecationWarning (a UserWarning subclass) at import time
(comprehensive review remediation, 2026-08-28). Importing the test client in
a fresh interpreter with UserWarnings promoted to errors must succeed —
proof that the supported dependency is installed. (The category form
-W error::starlette.exceptions.StarletteDeprecationWarning is rejected by
the interpreter at startup, so the UserWarning base class is the filter.)
"""
from __future__ import annotations

import subprocess
import sys


def test_testclient_import_is_warning_free():
    proc = subprocess.run(
        [
            sys.executable,
            "-W", "error::UserWarning",
            "-c",
            "from starlette.testclient import TestClient; "
            "from fastapi.testclient import TestClient as FastAPITestClient",
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
