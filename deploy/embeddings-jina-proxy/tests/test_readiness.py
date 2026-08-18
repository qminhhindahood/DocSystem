from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import main


def reset_readiness():
    main._readiness_checked_at = 0.0
    main._readiness_ok = False
    main._readiness_reason = "not checked"


def test_ready_rejects_missing_key_without_exposing_value():
    reset_readiness()
    with patch.object(main, "JINA_API_KEY", ""):
        response = TestClient(main.app).get("/ready")
    assert response.status_code == 503
    assert response.json()["detail"] == "JINA_API_KEY not set"


def test_ready_calls_provider_and_returns_sanitized_success():
    reset_readiness()
    provider_result = {"data": [{"embedding": [0.1, 0.2]}]}
    with patch.object(main, "JINA_API_KEY", "super-secret"), patch.object(
        main, "_call_jina", new=AsyncMock(return_value=provider_result)
    ) as call:
        response = TestClient(main.app).get("/ready")
    assert response.status_code == 200
    assert "super-secret" not in response.text
    call.assert_awaited_once()


def test_ready_returns_sanitized_503_when_provider_rejects_key():
    reset_readiness()
    with patch.object(main, "JINA_API_KEY", "super-secret"), patch.object(
        main, "_call_jina", new=AsyncMock(side_effect=RuntimeError("provider said secret=super-secret"))
    ):
        response = TestClient(main.app).get("/ready")
    assert response.status_code == 503
    assert response.json()["detail"] == "Jina embeddings service unavailable"
    assert "super-secret" not in response.text
