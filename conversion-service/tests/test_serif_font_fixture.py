"""Regression: fixture fonts must resolve on every CI/dev platform.

The fixture constants were once hardcoded to C:\\Windows\\Fonts\\times.ttf,
which made the whole conversion suite red on Linux CI (FzErrorSystem on
every fixture-building test). This test pins the contract the resolver
must keep: a real, loadable font file on the current OS, with Vietnamese
glyph coverage (the fixtures assert on Vietnamese diacritics).
"""
import fitz

from tests.serif_font import TIMES, TIMESBD


def test_regular_fixture_font_loads_with_vietnamese_coverage():
    font = fitz.Font(fontfile=TIMES)
    assert font.has_glyph(ord("ữ"))
    assert font.has_glyph(ord("Ệ"))


def test_bold_fixture_font_loads_with_vietnamese_coverage():
    font = fitz.Font(fontfile=TIMESBD)
    assert font.has_glyph(ord("ữ"))
    assert font.has_glyph(ord("Ệ"))
