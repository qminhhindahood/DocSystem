"""Tests for truthful embeddings readiness — /live vs /ready."""
from fastapi.testclient import TestClient
from main import app, _validate_model_config
import pytest
from unittest.mock import patch


@pytest.fixture(autouse=True)
def reset_model():
    """Reset _model to None before each test."""
    main_module = __import__("main")
    main_module._model = None
    main_module._model_load_error = None
    main_module._model_probe_passed = False
    main_module._model_device = None
    yield


class TestLiveReady:
    """/live always 200; /ready returns 503 when model not loaded."""

    def test_live_always_200(self):
        """Process liveness — /live returns 200 even when model is None."""
        client = TestClient(app)
        r = client.get("/live")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "alive"

    def test_ready_503_when_model_not_loaded(self):
        """Readiness — /ready returns 503 when _model is None."""
        import main as m
        m._model = None

        client = TestClient(app)
        r = client.get("/ready")
        assert r.status_code == 503
        data = r.json()
        assert data["status"] == "not ready"

    def test_ready_200_when_model_loaded(self):
        """Readiness requires both a loaded model and a successful encode probe."""
        import main as m
        m._model = object()  # anything truthy
        m._model_probe_passed = True
        m._model_device = "cpu"

        client = TestClient(app)
        r = client.get("/ready")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "ready"
        assert data["model_probe_passed"] is True

    def test_ready_503_when_model_exists_but_probe_failed(self):
        import main as m
        m._model = object()
        m._model_probe_passed = False

        client = TestClient(app)
        r = client.get("/ready")
        assert r.status_code == 503

    def test_embed_503_when_model_exists_but_probe_failed(self):
        import main as m
        m._model = object()
        m._model_probe_passed = False

        client = TestClient(app)
        r = client.post("/embed", json={"text": "must not be embedded"})
        assert r.status_code == 503

    def test_ready_503_when_model_load_error(self):
        """Readiness — /ready returns 503 when _model_load_error is set."""
        import main as m
        m._model = None
        m._model_load_error = "GPU out of memory"

        client = TestClient(app)
        r = client.get("/ready")
        assert r.status_code == 503

    def test_legacy_health_still_works(self):
        """Legacy /health endpoint continues to report model status."""
        client = TestClient(app)
        r = client.get("/health")
        assert r.status_code == 200
        data = r.json()
        assert "model_loaded" in data


def test_model_revision_must_be_an_immutable_commit():
    with patch("main.MODEL_REVISION", "main"):
        with pytest.raises(RuntimeError, match="full 40-character commit hash"):
            _validate_model_config()


def test_batch_rejects_too_many_texts():
    import main as m
    m._model = object()
    m._model_probe_passed = True
    client = TestClient(app)

    with patch("main.MAX_BATCH_TEXTS", 2):
        response = client.post("/embed/batch", json={"texts": ["a", "b", "c"]})

    assert response.status_code == 400
    assert "Batch exceeds limit" in response.json()["detail"]


def test_batch_rejects_excessive_total_characters():
    import main as m
    m._model = object()
    m._model_probe_passed = True
    client = TestClient(app)

    with patch("main.MAX_BATCH_TOTAL_CHARS", 3):
        response = client.post("/embed/batch", json={"texts": ["ab", "cd"]})

    assert response.status_code == 400
    assert "total characters" in response.json()["detail"]
