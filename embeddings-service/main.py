from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional
from contextlib import asynccontextmanager
import logging
import asyncio
import os
import re
from pathlib import Path
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
import torch

@asynccontextmanager
async def lifespan(_app: FastAPI):
    load_model()
    yield


app = FastAPI(title="Embeddings Service", version="1.0.0", lifespan=lifespan)

class EmbedRequest(BaseModel):
    text: str
    task_type: Optional[str] = "query"  # 'query' or 'text-document'

class EmbedResponse(BaseModel):
    embedding: List[float]
    dimensions: int

class BatchEmbedRequest(BaseModel):
    texts: List[str]
    task_type: Optional[str] = "text-document"

class BatchEmbedResponse(BaseModel):
    embeddings: List[List[float]]
    dimensions: int

# Global model variables
_model = None
_model_load_error = None
_model_probe_passed = False
_model_device = None
MAX_TEXT_LENGTH = 50000
MAX_BATCH_TEXTS = int(os.environ.get("EMBEDDING_MAX_BATCH_TEXTS", "64"))
MAX_BATCH_TOTAL_CHARS = int(os.environ.get("EMBEDDING_MAX_BATCH_TOTAL_CHARS", "250000"))
INFERENCE_BATCH_SIZE = int(os.environ.get("EMBEDDING_INFERENCE_BATCH_SIZE", "2"))
_encode_lock = asyncio.Lock()
MODEL_ID = os.environ.get("EMBEDDING_MODEL_ID", "jinaai/jina-embeddings-v5-text-small")
MODEL_REVISION = os.environ.get(
    "EMBEDDING_MODEL_REVISION",
    "dd76d535f5447ca3897a9c893fb1e612ead98192",
)
MODEL_CACHE_DIR = os.environ.get("EMBEDDING_MODEL_CACHE_DIR", "/models/sentence-transformers")
MODEL_LOCAL_FILES_ONLY = os.environ.get("EMBEDDING_MODEL_LOCAL_FILES_ONLY", "false").lower() == "true"
MODEL_SOURCE = os.environ.get("HF_ENDPOINT", "https://huggingface.co").rstrip("/")


def _task_and_prompt(task_type: str) -> tuple[str, str]:
    """Map the service's task_type contract to Jina v5 task + prompt_name.

    v5 uses a task-specific LoRA adapter plus a query/document prompt prefix
    instead of v3's task_type encoding mode.
    """
    if task_type == "classification":
        return "classification", "document"
    if task_type == "query":
        return "retrieval", "query"
    return "retrieval", "document"


def _validate_model_config() -> None:
    """Reject mutable model revisions and unusable cache paths before loading."""
    if not re.fullmatch(r"[0-9a-fA-F]{40}", MODEL_REVISION):
        raise RuntimeError("EMBEDDING_MODEL_REVISION must be a full 40-character commit hash")
    cache = Path(MODEL_CACHE_DIR)
    cache.mkdir(parents=True, exist_ok=True)
    if not os.access(cache, os.W_OK):
        raise RuntimeError(f"embedding model cache is not writable: {cache}")


def _pin_cache_main_ref() -> None:
    """Pin the cache 'main' ref to the audited revision.

    v5's custom modeling code requests its LoRA adapters via snapshot_download
    WITHOUT a revision, which resolves to the cache "main" ref. Without this
    pin it fails once HF_HUB_OFFLINE is enabled, so point it at the audited
    commit and prohibit network fallback.
    """
    main_ref = (
        Path(MODEL_CACHE_DIR)
        / f"models--{MODEL_ID.replace('/', '--')}"
        / "refs"
        / "main"
    )
    main_ref.parent.mkdir(parents=True, exist_ok=True)
    main_ref.write_text(MODEL_REVISION, encoding="ascii")


def _prefetch_immutable_model_sources() -> None:
    """Populate the exact model revision, then force all runtime resolution offline."""
    from huggingface_hub import snapshot_download

    snapshot_download(
        MODEL_ID,
        revision=MODEL_REVISION,
        cache_dir=MODEL_CACHE_DIR,
        local_files_only=MODEL_LOCAL_FILES_ONLY,
    )
    _pin_cache_main_ref()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import huggingface_hub.constants
    huggingface_hub.constants.HF_HUB_OFFLINE = True


def _probe_model(model) -> None:
    """Require a finite, correctly sized query vector before becoming ready."""
    import numpy as np

    task, prompt_name = _task_and_prompt("query")
    embeddings = model.encode(
        ["embedding readiness probe"],
        task=task,
        prompt_name=prompt_name,
        normalize_embeddings=True,
    )
    if getattr(embeddings, "shape", None) != (1, 1024):
        raise RuntimeError(f"unexpected readiness vector shape: {getattr(embeddings, 'shape', None)}")
    if not np.isfinite(embeddings).all():
        raise RuntimeError("readiness vector contains non-finite values")

def load_model():
    """Load an immutable model revision into a mountable cache and smoke-test it."""
    global _model, _model_load_error, _model_probe_passed, _model_device
    _model = None
    _model_probe_passed = False
    _model_device = None
    try:
        _validate_model_config()
        _prefetch_immutable_model_sources()
    except Exception as error:
        _model_load_error = f"{type(error).__name__}: {error}"
        logger.exception("Embedding model configuration is invalid")
        return

    devices = ["cuda", "cpu"] if torch.cuda.is_available() else ["cpu"]

    for device in devices:
        try:
            from sentence_transformers import SentenceTransformer
            candidate = SentenceTransformer(
                MODEL_ID,
                revision=MODEL_REVISION,
                cache_folder=MODEL_CACHE_DIR,
                local_files_only=True,
                device=device,
                trust_remote_code=True,
            )
            _probe_model(candidate)
            _model = candidate
            _model_device = device
            _model_probe_passed = True
            _model_load_error = None
            logger.info(
                "Embedding model ready: %s revision=%s device=%s cache=%s",
                MODEL_ID,
                MODEL_REVISION,
                device,
                MODEL_CACHE_DIR,
            )
            return
        except Exception as error:
            _model_load_error = f"{type(error).__name__}: {error}"
            logger.exception("Embedding model load/probe failed on %s", device)

    logger.error("Embedding model is unavailable after all device attempts")

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "embeddings",
        "version": "1.0.0",
        "model_loaded": _model is not None,
        "model_probe_passed": _model_probe_passed,
        "placeholder_mode": _model is None,
        # Redact internal error detail in production to avoid leaking stack traces
        **({"model_load_error": "model failed to load; check server logs"} if _model_load_error else {})
    }


@app.get("/live")
async def live():
    """Process-level liveness probe — always 200 if the server is running."""
    return {"status": "alive"}


@app.get("/ready")
async def ready():
    """Readiness probe — 200 only when the model is loaded, 503 otherwise."""
    if _model is None or not _model_probe_passed:
        return JSONResponse(
            status_code=503,
            content={"status": "not ready", "detail": "embedding model not loaded"},
        )
    return {
        "status": "ready",
        "model_loaded": True,
        "model_probe_passed": True,
        "model": MODEL_ID,
        "revision": MODEL_REVISION,
        "device": _model_device,
        "source": MODEL_SOURCE,
        "local_files_only": MODEL_LOCAL_FILES_ONLY,
    }

@app.post("/embed", response_model=EmbedResponse)
async def embed(request: EmbedRequest):
    """
    Generate embeddings for text.
    Uses Jina Embeddings V5 (jina-embeddings-v5-text-small) for multilingual support.

    Raises:
        HTTPException: 503 if model not loaded, 500 if embedding generation fails
    """
    global _model

    if len(request.text) > MAX_TEXT_LENGTH:
        raise HTTPException(status_code=400, detail=f"Text exceeds limit of {MAX_TEXT_LENGTH} characters")

    if _model is None or not _model_probe_passed:
        # M8 fix: do NOT return placeholder embeddings — they silently poison the
        # RAG index with garbage vectors. Surface a 503 so the caller stops indexing.
        logger.error(
            f"Embedding model not loaded; refusing to embed "
            f"(text len={len(request.text)}). Last load error: {_model_load_error}"
        )
        raise HTTPException(
            status_code=503,
            detail="Embedding model is not loaded. Indexing is unavailable; retry once the model is ready."
        )

    try:
        # Encode with task-aware mode. _model.encode is a blocking CPU/GPU call,
        # so run it in a worker thread to avoid blocking the event loop (M7).
        task_type = request.task_type or "query"
        task, prompt_name = _task_and_prompt(task_type)

        def _do_encode():
            return _model.encode(
                [request.text],
                task=task,
                prompt_name=prompt_name,
                normalize_embeddings=True,
            )

        async with _encode_lock:
            embeddings = await asyncio.to_thread(_do_encode)

        return EmbedResponse(
            embedding=embeddings[0].tolist(),
            dimensions=1024
        )
    except Exception as e:
        # Log the full error server-side for debugging
        logger.error(f"Embedding generation error: {e}", exc_info=True)
        # Return generic message to client (security: don't expose internal details)
        raise HTTPException(
            status_code=500,
            detail="Failed to generate embeddings. Please try again later."
        )

@app.post("/embed/batch", response_model=BatchEmbedResponse)
async def embed_batch(request: BatchEmbedRequest):
    """
    Generate embeddings for multiple texts in batch.
    Much more efficient than sequential single-text calls.
    """
    global _model

    if _model is None or not _model_probe_passed:
        # M8 fix: refuse to emit placeholder vectors; surface 503 instead.
        logger.error(
            f"Embedding model not loaded; refusing batch embed "
            f"({len(request.texts)} texts). Last load error: {_model_load_error}"
        )
        raise HTTPException(
            status_code=503,
            detail="Embedding model is not loaded. Batch indexing is unavailable; retry once the model is ready."
        )

    if not request.texts:
        return BatchEmbedResponse(embeddings=[], dimensions=1024)

    if len(request.texts) > MAX_BATCH_TEXTS:
        raise HTTPException(
            status_code=400,
            detail=f"Batch exceeds limit of {MAX_BATCH_TEXTS} texts",
        )

    for i, text in enumerate(request.texts):
        if len(text) > MAX_TEXT_LENGTH:
            raise HTTPException(
                status_code=400,
                detail=f"Text at index {i} exceeds limit of {MAX_TEXT_LENGTH} characters"
            )

    total_characters = sum(len(text) for text in request.texts)
    if total_characters > MAX_BATCH_TOTAL_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Batch exceeds limit of {MAX_BATCH_TOTAL_CHARS} total characters",
        )

    try:
        task_type = request.task_type or "text-document"
        task, prompt_name = _task_and_prompt(task_type)
        def _do_batch_encode():
            rows = []
            for offset in range(0, len(request.texts), INFERENCE_BATCH_SIZE):
                batch = request.texts[offset:offset + INFERENCE_BATCH_SIZE]
                encoded = _model.encode(
                    batch,
                    batch_size=INFERENCE_BATCH_SIZE,
                    task=task,
                    prompt_name=prompt_name,
                    normalize_embeddings=True,
                )
                rows.extend(encoded.tolist())
            return rows

        # Serialize model access and use bounded micro-batches to prevent CPU OOM.
        async with _encode_lock:
            embeddings = await asyncio.to_thread(_do_batch_encode)
        return BatchEmbedResponse(
            embeddings=embeddings,
            dimensions=1024
        )
    except Exception as e:
        logger.error(f"Batch embedding error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate batch embeddings")

@app.get("/info")
async def model_info():
    return {
        "model": MODEL_ID,
        "revision": MODEL_REVISION,
        "source": MODEL_SOURCE,
        "cache_dir": MODEL_CACHE_DIR,
        "local_files_only": MODEL_LOCAL_FILES_ONLY,
"dimensions": 1024,
        "languages": "multilingual (60+ languages)",
        "task_types": ["query", "text-document", "classification"]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
