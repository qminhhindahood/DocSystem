"""Download immutable embedding model inputs before enabling offline runtime."""

import os
import re
from pathlib import Path

from huggingface_hub import snapshot_download


def required_commit(name: str) -> str:
    value = os.environ[name]
    if not re.fullmatch(r"[0-9a-fA-F]{40}", value):
        raise RuntimeError(f"{name} must be a full 40-character commit hash")
    return value


def main() -> None:
    cache_dir = os.environ["EMBEDDING_MODEL_CACHE_DIR"]
    model_id = os.environ["EMBEDDING_MODEL_ID"]
    model_revision = required_commit("EMBEDDING_MODEL_REVISION")
    local_only = os.environ.get("EMBEDDING_MODEL_LOCAL_FILES_ONLY", "false").lower() == "true"

    snapshot_download(
        model_id,
        revision=model_revision,
        cache_dir=cache_dir,
        local_files_only=local_only,
    )

    # v5's custom modeling code downloads its LoRA adapters without a revision
    # (defaults to "main"); pin that ref so offline runtime resolution succeeds.
    main_ref = (
        Path(cache_dir)
        / f"models--{model_id.replace('/', '--')}"
        / "refs"
        / "main"
    )
    main_ref.parent.mkdir(parents=True, exist_ok=True)
    main_ref.write_text(model_revision, encoding="ascii")


if __name__ == "__main__":
    main()