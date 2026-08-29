"""test_quota_config.py — QUOTA_DAILY_LIMIT env configurability (ticket 01).

The daily quota must be env-configurable with a default of 50 (pilot policy,
grill Q6/Q11): env absent -> 50; valid value -> honored; invalid value ->
fail fast (no silent fallback to a stale default). Refund semantics are
untouched (covered by test_quota_refund*.py).
"""
from __future__ import annotations

import importlib

import pytest

import quota


def _reload_with_env(monkeypatch, value: str | None):
    """Reload quota with QUOTA_DAILY_LIMIT set (or removed) and return it."""
    if value is None:
        monkeypatch.delenv("QUOTA_DAILY_LIMIT", raising=False)
    else:
        monkeypatch.setenv("QUOTA_DAILY_LIMIT", value)
    # config is imported by quota at module load; reload both so the env
    # change is visible through config.DAILY_QUOTA_LIMIT.
    import config

    importlib.reload(config)
    return importlib.reload(quota)


class TestDefaultLimit:
    def test_env_absent_defaults_to_50(self, monkeypatch):
        mod = _reload_with_env(monkeypatch, None)
        assert mod.DEFAULT_DAILY_LIMIT == 50

    def test_new_service_uses_default_50(self, monkeypatch):
        mod = _reload_with_env(monkeypatch, None)
        service = mod.QuotaService(redis_client=None)
        assert service.limit == 50

    def test_worker_and_main_construction_honor_env(self, monkeypatch):
        # The ticket demands the runtime entrypoints pick the limit up from
        # config (constructor wiring), not just the module constant.
        mod = _reload_with_env(monkeypatch, "7")
        service = mod.QuotaService(redis_client=None)
        assert service.limit == 7


class TestExplicitLimit:
    def test_env_seven_is_honored(self, monkeypatch):
        mod = _reload_with_env(monkeypatch, "7")
        assert mod.DEFAULT_DAILY_LIMIT == 7
        assert mod.QuotaService(redis_client=None).limit == 7

    def test_env_one_hundred_is_honored(self, monkeypatch):
        mod = _reload_with_env(monkeypatch, "100")
        assert mod.QuotaService(redis_client=None).limit == 100


class TestInvalidValuesFailFast:
    @pytest.mark.parametrize("bogus", ["bogus", "", "-5", "0", "4.5"])
    def test_bogus_env_raises_at_import(self, monkeypatch, bogus):
        with pytest.raises(RuntimeError, match="QUOTA_DAILY_LIMIT"):
            _reload_with_env(monkeypatch, bogus)

    def test_charge_semantics_unchanged(self, monkeypatch):
        # limit=3 explicit constructor arg still wins over env (tests rely on
        # this; env only drives the *default*).
        mod = _reload_with_env(monkeypatch, "7")
        service = mod.QuotaService(redis_client=None, limit=3)
        assert service.limit == 3
        # 4th charge within the day is refused at limit 3.
        for _ in range(3):
            charge, remaining = service.charge("user-x")
            assert charge is not None
        charge, remaining = service.charge("user-x")
        assert charge is None
        assert remaining == 0
