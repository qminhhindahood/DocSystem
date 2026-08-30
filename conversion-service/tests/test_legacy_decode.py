"""test_legacy_decode.py — TCVN3/VNI legacy byte decoders (ticket 04).

The mapping tables are the critical artifact: a wrong byte mapping produces
confidently-wrong "lossless" Vietnamese. Tables were cross-validated against
two independent published sources (73/73 single-byte agreement on overlap;
uppercase composites follow the standard base-letter + tone-byte convention).

Sources:
- bongmeomeovn/TCVN3-Convert-Unicode mapping.txt (single-byte TCVN3)
- vuthaihoc/py-unicode-convert converter.py (TCVN3 composites + VNI tables)

All byte-level fixtures are loaded from tests/fixtures_legacy.json, which is
generated from the same verified tables — never hand-typed (hand-typing
high-byte mojibake produced wrong fixtures once already; the discipline is
now: fixtures come from the tables or they don't exist).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from legacy.decode import (
    DecodeResult,
    decode_best,
    decode_tcvn3,
    decode_vni,
    viet_health,
)

FIXTURES = json.loads(
    (Path(__file__).parent / "fixtures_legacy.json").read_text(encoding="utf-8")
)


class TestTCVN3Decode:
    """CER = 0 through the verified tables."""

    def test_phrase_roundtrip_cer_zero(self):
        raw = FIXTURES["tcvn3_phrase"]
        r = decode_tcvn3(raw)
        assert r.text == FIXTURES["tcvn3_expected"]
        assert r.changed is True
        assert r.encoding == "TCVN3"

    def test_single_bytes_decode(self):
        # 2 programmatic spot checks straight from the verified table:
        # chr(184) -> á (mapping.txt line 2), chr(174) -> đ (line 18)
        r = decode_tcvn3("B" + chr(184))
        assert r.text == "Bá"
        r2 = decode_tcvn3(chr(174) + "inh")
        assert r2.text == "đinh"

    def test_uppercase_composite(self):
        # Uppercase accented vowels come from composites: A + chr(184) -> Á.
        # Lowercase tone bytes after a non-vowel letter stay lowercase: L + chr(184) -> Lá.
        assert decode_tcvn3("A" + chr(184) + "N").text == "ÁN"
        assert decode_tcvn3("A" + chr(181)).text == "À"
        assert decode_tcvn3("L" + chr(184) + "N").text == "LáN"

    def test_ascii_identity(self):
        r = decode_tcvn3("Hop dong dich vu 01/2026")
        assert r.text == "Hop dong dich vu 01/2026"
        assert r.changed is False
        assert r.encoding is None


class TestVNIDecode:
    def test_phrase_roundtrip_cer_zero(self):
        raw = FIXTURES["vni_phrase"]
        r = decode_vni(raw)
        assert r.text == FIXTURES["vni_expected"]
        assert r.encoding == "VNI"

    def test_vni_pair_spot_checks(self):
        # from the VNI table: 'aø' -> 'à', 'tr' not a pair, 'ñ' -> 'đ'
        r = decode_vni("a" + chr(248))
        assert r.text == "à"
        r2 = decode_vni(chr(241) + "i")
        assert r2.text == "đi"


class TestDecodeBestGuard:
    """decode_best only fires when decoding genuinely helps — the Latin-1
    overlap guard (TCVN3 keys collide with healthy Unicode codepoints)."""

    def test_healthy_unicode_not_decoded(self):
        healthy = "Cộng hòa xã hội chủ nghĩa Việt Nam"
        assert decode_best(healthy) is None

    def test_latin1_text_without_health_gain_not_decoded(self):
        # French/Latin-1 diacritics share codepoints with TCVN3 bytes, but
        # decoding them yields no diacritic-health GAIN (base == decoded),
        # so the guard rejects — non-Vietnamese text is never mojibake-decoded.
        fr = "école à Paris, café crème et hôtel"
        assert decode_best(fr) is None

    def test_garbage_ascii_not_decoded(self):
        assert decode_best("") is None
        assert decode_best("plain ascii") is None

    def test_tcvn3_garbage_decoded(self):
        r = decode_best(FIXTURES["tcvn3_phrase"])
        assert r is not None
        assert r.encoding == "TCVN3"
        assert r.text == FIXTURES["tcvn3_expected"]

    def test_vni_garbage_decoded(self):
        r = decode_best(FIXTURES["vni_phrase"])
        assert r is not None
        assert r.text == FIXTURES["vni_expected"]


class TestHealth:
    def test_health_of_healthy_phrase(self):
        assert viet_health("Cộng hòa xã hội") > 0.15

    def test_health_of_plain_ascii(self):
        assert viet_health("plain ascii text") == 0.0


class TestContract:
    def test_result_is_structured(self):
        r = decode_tcvn3("x")
        assert isinstance(r, DecodeResult)
        assert hasattr(r, "text")
        assert hasattr(r, "changed")
        assert hasattr(r, "healthy")
        assert hasattr(r, "encoding")
