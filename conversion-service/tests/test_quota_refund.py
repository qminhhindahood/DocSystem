"""tests/test_quota_refund.py — quota charged only after validation (P4 review)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
import main
from quota import QuotaService


def _reset_quota(monkey_user="quota-review-user"):
    """Ensure the quota counter for the test user is empty."""
    qs = main.QUOTA
    key = qs._key(monkey_user)
    if qs._redis is not None:
        qs._redis.delete(key)
    else:
        qs._memory.pop(key, None)


def test_invalid_pdf_does_not_consume_quota():
    _reset_quota()
    with TestClient(main.app) as client:
        # bytes are NOT a valid PDF (wrong magic) -> 422 from check_password? No,
        # magic-byte check fails first -> 400 IntakeError before quota.
        bad = b"this is not a pdf at all"
        r = client.post(
            "/convert",
            headers={"X-User-Id": "quota-review-user"},
            files={"file": ("bad.pdf", bad, "application/pdf")},
        )
        assert r.status_code in (400, 422), r.text
        # The quota for this user must NOT have been incremented.
        key = main.QUOTA._key("quota-review-user")
        if main.QUOTA._redis is not None:
            current = int(main.QUOTA._redis.get(key) or 0)
        else:
            current = main.QUOTA._memory.get(key, (0, 0.0))[0]
        assert current == 0, f"invalid upload consumed quota ({current})"


def test_quota_charged_only_after_validation_bulk():
    _reset_quota()
    with TestClient(main.app) as client:
        # two invalid files to /convert/bulk -> neither consumes quota
        bad = b"not a pdf"
        r = client.post(
            "/convert/bulk",
            headers={"X-User-Id": "quota-review-user"},
            files=[("files", ("a.pdf", bad, "application/pdf")),
                   ("files", ("b.pdf", bad, "application/pdf"))],
        )
        assert r.status_code == 200
        body = r.json()
        # both rejected at validation, none consumed quota
        assert all(j["jobId"] is None for j in body["jobs"])
        key = main.QUOTA._key("quota-review-user")
        if main.QUOTA._redis is not None:
            current = int(main.QUOTA._redis.get(key) or 0)
        else:
            current = main.QUOTA._memory.get(key, (0, 0.0))[0]
        assert current == 0, f"invalid bulk upload consumed quota ({current})"
