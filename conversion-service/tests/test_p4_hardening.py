"""tests/test_p4_hardening.py — P4 metrics, alerts, review data, bulk."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from metrics import Metrics
from pipeline import _flagged_blocks, _low_confidence_pages
from schema.blocks import ParagraphBlock


def test_metrics_counters_and_prometheus():
    m = Metrics()
    m.inc("conversion_jobs_total", status="completed")
    m.inc("conversion_jobs_total", status="completed")
    m.inc("conversion_jobs_total", status="failed")
    m.observe_duration(1.5)
    m.observe_confidence(0.9)
    text = m.render_prometheus()
    assert 'conversion_jobs_total{status="completed"} 2' in text
    assert 'conversion_jobs_total{status="failed"} 1' in text
    assert "conversion_confidence_avg 0.9" in text
    assert "conversion_uptime_seconds" in text


def test_failure_rate_alert():
    m = Metrics(outcomes=10)
    for _ in range(4):
        m.record_outcome("completed")
    assert m.alerts() == []  # below min samples or rate
    for _ in range(6):
        m.record_outcome("failed")
    alerts = m.alerts()
    assert any("high_failure_rate" in a for a in alerts)


def test_no_alert_below_min_samples():
    m = Metrics(outcomes=10)
    m.record_outcome("failed")
    m.record_outcome("failed")
    assert m.failure_rate() is None
    assert m.alerts() == []


def test_flagged_blocks_threshold():
    blocks = [
        ParagraphBlock(text="ok", confidence=0.9, page=1),
        ParagraphBlock(text="rủi ro", confidence=0.4, page=1),
        ParagraphBlock(text="ranh giới", confidence=0.6, page=2),  # not < 0.6
    ]
    flagged = _flagged_blocks(blocks)
    assert len(flagged) == 1
    assert flagged[0]["index"] == 1
    assert flagged[0]["confidence"] == 0.4
    assert flagged[0]["preview"] == "rủi ro"


def test_low_confidence_pages():
    blocks = [
        ParagraphBlock(text="a", confidence=0.5, page=1),
        ParagraphBlock(text="b", confidence=0.6, page=1),   # page 1 avg 0.55 < 0.7
        ParagraphBlock(text="c", confidence=0.9, page=2),   # page 2 fine
    ]
    pages = _low_confidence_pages(blocks)
    assert len(pages) == 1
    assert pages[0]["page"] == 1
    assert pages[0]["avg_confidence"] == 0.55


def test_bulk_max_files_config():
    import config
    assert config.BULK_MAX_FILES >= 1


def test_render_prometheus_merges_redis_worker_counters():
    m = Metrics()
    text = m.render_prometheus(queue_depth=2, extra={"jobs:completed": 3, "pages:DIGITAL_TEXT": 3})
    assert "conversion_queue_depth 2" in text
    assert "conversion_jobs_completed_total 3" in text
    assert "conversion_pages_DIGITAL_TEXT_total 3" in text


def test_record_redis_skips_without_client():
    m = Metrics()
    m.record_redis("jobs:completed")  # no client -> no-op, no crash
    assert True
