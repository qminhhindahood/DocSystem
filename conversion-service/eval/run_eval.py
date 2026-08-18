"""eval/run_eval.py — executable quality harness (CONVERSION_SERVICE_PLAN.md §12).

Definitions:
- A BLOCK = one node in the JSON schema.
- A block is CORRECT when: type matches ground truth AND text CER < 2% AND
  position is within +/-1 slot of ground truth.

Metrics & targets:
- Hallucination rate: n-grams in output absent from source -> 0%
- Content fidelity: CER vs source (< 2% digital, < 5% scanned)
- Structure: block-type F1 over aligned blocks (>= 95%)
- Seal recall: seals in source vs reported as image blocks (100%)
- Decree 30 checklist: automated DOCX inspection (100%)
- Demotion rate: Stage-4 demotions / blocks (tracked)

This module is importable (used by tests) and runnable:
    python -m eval.run_eval --fixture eval/fixtures/quyet_dinh.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

# Allow running as a script from the service root.
SERVICE_ROOT = Path(__file__).resolve().parent.parent
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from schema.blocks import Block, parse_blocks  # noqa: E402


# ─── Character Error Rate ─────────────────────────────────────────────────────

def cer(reference: str, hypothesis: str) -> float:
    """Character error rate via Levenshtein distance / len(reference)."""
    ref = reference.strip()
    hyp = hypothesis.strip()
    if not ref:
        return 0.0 if not hyp else 1.0
    # classic DP edit distance
    prev = list(range(len(hyp) + 1))
    for i, rc in enumerate(ref, 1):
        cur = [i]
        for j, hc in enumerate(hyp, 1):
            cost = 0 if rc == hc else 1
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost))
        prev = cur
    return prev[-1] / len(ref)


# ─── Hallucination (n-gram) ───────────────────────────────────────────────────

def _ngrams(text: str, n: int = 3) -> set[str]:
    words = text.split()
    return {" ".join(words[i:i + n]) for i in range(len(words) - n + 1)}


def hallucination_rate(source_text: str, output_text: str, n: int = 3) -> float:
    """Fraction of output n-grams absent from the source. Target: 0%."""
    out_grams = _ngrams(output_text, n)
    if not out_grams:
        return 0.0
    src_grams = _ngrams(source_text, n)
    # also allow sub-string containment for short sources
    hallucinated = 0
    for g in out_grams:
        if g not in src_grams and g not in source_text:
            hallucinated += 1
    return hallucinated / len(out_grams)


# ─── Block text extraction ────────────────────────────────────────────────────

def block_text(block: Block) -> str:
    """Best-effort plain text of a block for CER / hallucination checks."""
    t = block.type
    if t in ("heading",):
        return block.text
    if t == "paragraph":
        return block.plain_text()
    if t == "list":
        return " ".join(it.text for it in block.items)
    if t == "table":
        cells = []
        for row in list(block.headers) + list(block.rows):
            cells.extend(c.text for c in row)
        return " ".join(cells)
    if t == "admin_header":
        parts = [
            block.left.superior_agency, block.left.issuing_agency,
            block.left.document_number, block.right.country_name,
            block.right.motto, block.right.location_and_date,
        ]
        return " ".join(p for p in parts if p)
    if t == "signature":
        parts = list(block.left.receipt_list) + [
            block.right.authority, block.right.title, block.right.name,
        ]
        return " ".join(p for p in parts if p)
    if t == "section_break":
        return block.label or ""
    return ""


# ─── Structure F1 (block-type) ────────────────────────────────────────────────

def block_type_f1(pred_blocks: list[Block], gold_blocks: list[Block]) -> dict[str, float]:
    """Block-type F1 over aligned blocks (position within +/-1 slot)."""
    gold_types = [b.type for b in gold_blocks]
    pred_types = [b.type for b in pred_blocks]

    matched = 0
    used_gold = set()
    for pi, pt in enumerate(pred_types):
        for gi in range(max(0, pi - 1), min(len(gold_types), pi + 2)):
            if gi in used_gold:
                continue
            if gold_types[gi] == pt:
                matched += 1
                used_gold.add(gi)
                break
    precision = matched / len(pred_types) if pred_types else 0.0
    recall = matched / len(gold_types) if gold_types else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    return {"precision": precision, "recall": recall, "f1": f1, "matched": matched}


# ─── Seal recall ──────────────────────────────────────────────────────────────

def seal_recall(pred_blocks: list[Block], gold_blocks: list[Block]) -> float:
    gold_seals = sum(1 for b in gold_blocks if b.type == "image" and b.kind == "seal")
    if gold_seals == 0:
        return 1.0
    pred_seals = sum(1 for b in pred_blocks if b.type == "image" and b.kind == "seal")
    return min(pred_seals, gold_seals) / gold_seals


# ─── Report card ──────────────────────────────────────────────────────────────

def evaluate(
    pred_blocks: list[Block],
    gold_blocks: list[Block],
    source_text: str | None = None,
) -> dict[str, Any]:
    """Produce a per-doc report card."""
    pred_text = " ".join(block_text(b) for b in pred_blocks)
    gold_text = " ".join(block_text(b) for b in gold_blocks)

    overall_cer = cer(gold_text, pred_text)
    f1 = block_type_f1(pred_blocks, gold_blocks)
    s_recall = seal_recall(pred_blocks, gold_blocks)
    halluc = (
        hallucination_rate(source_text, pred_text)
        if source_text is not None
        else hallucination_rate(gold_text, pred_text)
    )

    return {
        "cer": round(overall_cer, 4),
        "block_type_f1": round(f1["f1"], 4),
        "block_type_precision": round(f1["precision"], 4),
        "block_type_recall": round(f1["recall"], 4),
        "seal_recall": round(s_recall, 4),
        "hallucination_rate": round(halluc, 4),
        "num_pred_blocks": len(pred_blocks),
        "num_gold_blocks": len(gold_blocks),
    }


def load_fixture(path: str | Path) -> list[Block]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return parse_blocks(data)


def main() -> int:
    ap = argparse.ArgumentParser(description="Conversion eval harness")
    ap.add_argument("--fixture", required=True, help="path to a fixture JSON")
    ap.add_argument("--gold", help="path to ground-truth JSON (defaults to fixture)")
    args = ap.parse_args()

    pred = load_fixture(args.fixture)
    gold = load_fixture(args.gold or args.fixture)
    report = evaluate(pred, gold)

    print(json.dumps(report, indent=2, ensure_ascii=False))
    # P0a self-check gate: a fixture evaluated against itself must be perfect.
    ok = (
        report["cer"] == 0.0
        and report["block_type_f1"] == 1.0
        and report["seal_recall"] == 1.0
        and report["hallucination_rate"] == 0.0
    )
    print("SELF-CHECK:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
