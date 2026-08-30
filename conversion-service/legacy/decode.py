"""legacy/decode.py — TCVN3/VNI byte decoders (ticket 04).

Legacy administrative PDFs embed fonts whose glyph codes are TCVN3 (TCVN
5710:1993) or VNI byte sequences without ToUnicode CMaps; PyMuPDF extracts
them as garbled high-byte text. Decoding through the standard tables is the
only lossless path — OCR can never be lossless.

SAFETY (critical): TCVN3 keys overlap the Latin-1 range (e.g. byte 225 ->
U+1EA3 'ả' while Unicode 'á' is U+00E1 = 225), so decoding healthy Unicode
would corrupt it. Two guards keep that from happening:
  1. health gain — decode_best only accepts a decode that improves the
     Vietnamese diacritic health by >= HEALTH_GAIN;
  2. round-trip identity — the accepted decode must re-encode to exactly
     the source bytes (this is also what makes the result provably
     lossless and discriminates TCVN3 from VNI: a TCVN3-misdecode of VNI
     bytes never re-encodes identically).

Tables cross-validated against two independent published sources
(73/73 single-byte agreement on overlap; see tests/test_legacy_decode.py):
- https://github.com/bongmeomeovn/TCVN3-Convert-Unicode (mapping.txt)
- https://github.com/vuthaihoc/py-unicode-convert (converter.py)
The one cross-source disagreement (mapping.txt maps ASCII hyphen 45 to ư)
is resolved toward identity: a wrongly-eaten hyphen is worse than a missed
rare form.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DecodeResult:
    """Structured decode outcome for triage routing."""

    text: str
    changed: bool          # any byte was decoded
    healthy: bool          # post-decode text passes the VN health floor
    encoding: str | None   # "TCVN3" | "VNI" when changed
    pairs_used: int = 0    # 2-char composites consumed (VNI signature)


# Vietnamese diacritics — same set as triage.VIET_DIACRITICS.
VIET_DIACRITICS = set(
    "àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩị"
    "òóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ"
)

HEALTH_FLOOR = 0.15        # healthy VN prose carries ~20-40% diacritics
HEALTH_GAIN = 0.10         # decode must IMPROVE health by this margin


def viet_health(text: str) -> float:
    """Fraction of letters carrying Vietnamese diacritics."""
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 0.0
    return sum(1 for c in letters if c.lower() in VIET_DIACRITICS) / len(letters)


def _decode(raw: str, single: dict, composite: dict, encoding: str) -> DecodeResult:
    """Longest-match decode: composites (2 chars) first, then singles."""
    out: list[str] = []
    changed = False
    pairs_used = 0
    i, n = 0, len(raw)
    while i < n:
        pair = raw[i : i + 2]
        if pair in composite:
            out.append(composite[pair])
            changed = True
            pairs_used += 1
            i += 2
            continue
        cp = ord(raw[i])
        if cp in single:
            out.append(single[cp])
            changed = True
            i += 1
            continue
        out.append(raw[i])
        i += 1
    text = "".join(out)
    if not changed:
        return DecodeResult(raw, False, viet_health(raw) >= HEALTH_FLOOR, None, 0)
    return DecodeResult(text, True, viet_health(text) >= HEALTH_FLOOR, encoding, pairs_used)


def decode_tcvn3(raw: str) -> DecodeResult:
    """Decode TCVN3 bytes (as extracted chars) to Unicode."""
    return _decode(raw, TCVN3_SINGLE, TCVN3_COMPOSITE, "TCVN3")


def decode_vni(raw: str) -> DecodeResult:
    """Decode VNI bytes (as extracted chars) to Unicode."""
    return _decode(raw, VNI_SINGLE, VNI_COMPOSITE, "VNI")


def _encode(text: str, table: dict[str, str]) -> str:
    out: list[str] = []
    for ch in text:
        out.append(table.get(ch, ch))
    return "".join(out)


def decode_best(raw: str) -> DecodeResult | None:
    """Pick the decode that is provably lossless for this raw text, or None.

    A decode is accepted only when it (a) changed bytes, (b) produced
    healthy Vietnamese, (c) improved diacritic health by >= HEALTH_GAIN
    (keeps healthy Unicode out of the legacy path despite Latin-1 overlap),
    and (d) re-encodes byte-identically to the source (lossless proof +
    TCVN3/VNI discrimination). TCVN3 is tried first — administrative
    legacy documents are overwhelmingly TCVN3.
    """
    if not raw:
        return None
    base = viet_health(raw)
    candidates: list[DecodeResult] = []
    for decoder, encoder in (
        (decode_tcvn3, lambda t: _encode(t, TCVN3_ENCODE)),
        (decode_vni, lambda t: _encode(t, VNI_ENCODE)),
    ):
        r = decoder(raw)
        if not (r.changed and r.healthy):
            continue
        if viet_health(r.text) < base + HEALTH_GAIN:
            continue
        if encoder(r.text) != raw:
            continue
        candidates.append(r)
    if not candidates:
        return None
    # TCVN3's single-byte table bijects the same high bytes VNI uses, so both
    # decodes can roundtrip on VNI text — but VNI's signature is composite
    # pairs (base+tone), which a TCVN3 misdecode consumes none of. Most
    # composite pairs wins; ties go to TCVN3 (legacy admin docs are
    # overwhelmingly TCVN3).
    return max(candidates, key=lambda r: r.pairs_used)


TCVN3_SINGLE = {
    161: "Ă",
    162: "Â",
    163: "Ê",
    164: "Ô",
    165: "Ơ",
    166: "Ư",
    167: "Đ",
    168: "ă",
    169: "â",
    170: "ê",
    171: "ô",
    172: "ơ",
    173: "ư",
    174: "đ",
    181: "à",
    182: "ả",
    183: "ã",
    184: "á",
    185: "ạ",
    187: "ằ",
    188: "ẳ",
    189: "ẵ",
    190: "ắ",
    198: "ặ",
    199: "ầ",
    200: "ẩ",
    201: "ẫ",
    202: "ấ",
    203: "ậ",
    204: "è",
    206: "ẻ",
    207: "ẽ",
    208: "é",
    209: "ẹ",
    210: "ề",
    211: "ể",
    212: "ễ",
    213: "ế",
    214: "ệ",
    215: "ì",
    216: "ỉ",
    220: "ĩ",
    221: "í",
    222: "ị",
    223: "ò",
    225: "ỏ",
    226: "õ",
    227: "ó",
    228: "ọ",
    229: "ồ",
    230: "ổ",
    231: "ỗ",
    232: "ố",
    233: "ộ",
    234: "ờ",
    235: "ở",
    236: "ỡ",
    237: "ớ",
    238: "ợ",
    239: "ù",
    241: "ủ",
    242: "ũ",
    243: "ú",
    244: "ụ",
    245: "ừ",
    246: "ử",
    247: "ữ",
    248: "ứ",
    249: "ự",
    250: "ỳ",
    251: "ỷ",
    252: "ỹ",
    253: "ý",
    254: "ỵ",
}

TCVN3_COMPOSITE = {
    "Aµ": "À",
    "A¸": "Á",
    "A·": "Ã",
    "A¹": "Ạ",
    "A¶": "Ả",
    "EÌ": "È",
    "EÐ": "É",
    "EÑ": "Ẹ",
    "EÎ": "Ẻ",
    "EÏ": "Ẽ",
    "I×": "Ì",
    "IÝ": "Í",
    "IÜ": "Ĩ",
    "IØ": "Ỉ",
    "IÞ": "Ị",
    "Oß": "Ò",
    "Oã": "Ó",
    "Oâ": "Õ",
    "Oä": "Ọ",
    "Oá": "Ỏ",
    "Uï": "Ù",
    "Uó": "Ú",
    "Uò": "Ũ",
    "Uô": "Ụ",
    "Uñ": "Ủ",
    "Yý": "Ý",
    "Yú": "Ỳ",
    "Yþ": "Ỵ",
    "Yû": "Ỷ",
    "Yü": "Ỹ",
    "¡¾": "Ắ",
    "¡»": "Ằ",
    "¡¼": "Ẳ",
    "¡½": "Ẵ",
    "¡Æ": "Ặ",
    "¢Ê": "Ấ",
    "¢Ç": "Ầ",
    "¢È": "Ẩ",
    "¢É": "Ẫ",
    "¢Ë": "Ậ",
    "£Õ": "Ế",
    "£Ò": "Ề",
    "£Ó": "Ể",
    "£Ô": "Ễ",
    "£Ö": "Ệ",
    "¤è": "Ố",
    "¤å": "Ồ",
    "¤æ": "Ổ",
    "¤ç": "Ỗ",
    "¤é": "Ộ",
    "¥í": "Ớ",
    "¥ê": "Ờ",
    "¥ë": "Ở",
    "¥ì": "Ỡ",
    "¥î": "Ợ",
    "¦ø": "Ứ",
    "¦õ": "Ừ",
    "¦ö": "Ử",
    "¦÷": "Ữ",
    "¦ù": "Ự",
}

VNI_PAIRS = {
    "AØ": "À",
    "AÙ": "Á",
    "AÂ": "Â",
    "AÕ": "Ã",
    "AÊ": "Ă",
    "AÏ": "Ạ",
    "AÛ": "Ả",
    "AÁ": "Ấ",
    "AÀ": "Ầ",
    "AÅ": "Ẩ",
    "AÃ": "Ẫ",
    "AÄ": "Ậ",
    "AÉ": "Ắ",
    "AÈ": "Ằ",
    "AÚ": "Ẳ",
    "AÜ": "Ẵ",
    "AË": "Ặ",
    "EØ": "È",
    "EÙ": "É",
    "EÂ": "Ê",
    "EÏ": "Ẹ",
    "EÛ": "Ẻ",
    "EÕ": "Ẽ",
    "EÁ": "Ế",
    "EÀ": "Ề",
    "EÅ": "Ể",
    "EÃ": "Ễ",
    "EÄ": "Ệ",
    "OØ": "Ò",
    "OÙ": "Ó",
    "OÂ": "Ô",
    "OÕ": "Õ",
    "OÏ": "Ọ",
    "OÛ": "Ỏ",
    "OÁ": "Ố",
    "OÀ": "Ồ",
    "OÅ": "Ổ",
    "OÃ": "Ỗ",
    "OÄ": "Ộ",
    "UØ": "Ù",
    "UÙ": "Ú",
    "UÕ": "Ũ",
    "UÏ": "Ụ",
    "UÛ": "Ủ",
    "YÙ": "Ý",
    "YØ": "Ỳ",
    "YÛ": "Ỷ",
    "YÕ": "Ỹ",
    "aø": "à",
    "aù": "á",
    "aâ": "â",
    "aõ": "ã",
    "aê": "ă",
    "aï": "ạ",
    "aû": "ả",
    "aá": "ấ",
    "aà": "ầ",
    "aå": "ẩ",
    "aã": "ẫ",
    "aä": "ậ",
    "aé": "ắ",
    "aè": "ằ",
    "aú": "ẳ",
    "aü": "ẵ",
    "aë": "ặ",
    "eø": "è",
    "eù": "é",
    "eâ": "ê",
    "eï": "ẹ",
    "eû": "ẻ",
    "eõ": "ẽ",
    "eá": "ế",
    "eà": "ề",
    "eå": "ể",
    "eã": "ễ",
    "eä": "ệ",
    "oø": "ò",
    "où": "ó",
    "oâ": "ô",
    "oõ": "õ",
    "oï": "ọ",
    "oû": "ỏ",
    "oá": "ố",
    "oà": "ồ",
    "oå": "ổ",
    "oã": "ỗ",
    "oä": "ộ",
    "uø": "ù",
    "uù": "ú",
    "uõ": "ũ",
    "uï": "ụ",
    "uû": "ủ",
    "yù": "ý",
    "yø": "ỳ",
    "yû": "ỷ",
    "yõ": "ỹ",
    "Æ": "Ỉ",
    "Ì": "Ì",
    "Í": "Í",
    "Î": "Ỵ",
    "Ñ": "Đ",
    "Ò": "Ị",
    "Ó": "Ĩ",
    "Ô": "Ơ",
    "ÔÙ": "Ớ",
    "ÔØ": "Ờ",
    "ÔÛ": "Ở",
    "ÔÕ": "Ỡ",
    "ÔÏ": "Ợ",
    "Ö": "Ư",
    "ÖÙ": "Ứ",
    "ÖØ": "Ừ",
    "ÖÛ": "Ử",
    "ÖÕ": "Ữ",
    "ÖÏ": "Ự",
    "æ": "ỉ",
    "ì": "ì",
    "í": "í",
    "î": "ỵ",
    "ñ": "đ",
    "ò": "ị",
    "ó": "ĩ",
    "ô": "ơ",
    "ôù": "ớ",
    "ôø": "ờ",
    "ôû": "ở",
    "ôõ": "ỡ",
    "ôï": "ợ",
    "ö": "ư",
    "öù": "ứ",
    "öø": "ừ",
    "öû": "ử",
    "öõ": "ữ",
    "öï": "ự",
}

# VNI tables: pairs (base+tone, 2 chars) and single-byte letters,
# split once after the combined source table above.
VNI_COMPOSITE: dict[str, str] = {
    k: v for k, v in VNI_PAIRS.items() if len(k) == 2
}
VNI_SINGLE: dict[int, str] = {
    ord(k): v for k, v in VNI_PAIRS.items() if len(k) == 1
}

# Encoders (inverse maps) for the round-trip identity guard.
TCVN3_ENCODE: dict[str, str] = {v: chr(k) for k, v in TCVN3_SINGLE.items()}
TCVN3_ENCODE.update({v: k for k, v in TCVN3_COMPOSITE.items()})
VNI_ENCODE: dict[str, str] = {v: k for k, v in VNI_PAIRS.items()}
