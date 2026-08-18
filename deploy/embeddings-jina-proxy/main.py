import os
import logging
import asyncio
import math
import time
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

JINA_API_KEY = os.environ.get("JINA_API_KEY", "")
JINA_BASE = os.environ.get("JINA_BASE_URL", "https://api.jina.ai/v1").rstrip("/")
JINA_MODEL = os.environ.get("JINA_MODEL", "jina-embeddings-v5-omni-small")
PORT = int(os.environ.get("PORT", 8002))
READINESS_TTL_SECONDS = max(1, int(os.environ.get("JINA_READINESS_TTL_SECONDS", "60")))
_readiness_lock = asyncio.Lock()
_readiness_checked_at = 0.0
_readiness_ok = False
_readiness_reason = "not checked"

app = FastAPI(title="Jina Embeddings Proxy", version="1.0.0")


class EmbedRequest(BaseModel):
    text: str
    task_type: Optional[str] = "query"

class EmbedResponse(BaseModel):
    embedding: List[float]
    dimensions: int

class BatchEmbedRequest(BaseModel):
    texts: List[str]
    task_type: Optional[str] = "text-document"

class BatchEmbedResponse(BaseModel):
    embeddings: List[List[float]]
    dimensions: int


async def _call_jina(texts: list[str], task: str) -> dict:
    headers = {
        "Authorization": f"Bearer {JINA_API_KEY}",
        "Content-Type": "application/json",
        "X-Suppress-Streaming-User-Agent": "true",
    }
    payload = {
        "model": JINA_MODEL,
        "input": texts,
        "task": task,
    }
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(f"{JINA_BASE}/embeddings", json=payload, headers=headers)
        if r.status_code != 200:
            logger.error("Jina API error status=%s", r.status_code)
            raise HTTPException(502, f"Jina API returned {r.status_code}")
        return r.json()


async def _check_upstream_readiness() -> tuple[bool, str]:
    """Make a cached real embedding call without returning provider details."""
    global _readiness_checked_at, _readiness_ok, _readiness_reason
    now = time.monotonic()
    if now - _readiness_checked_at < READINESS_TTL_SECONDS:
        return _readiness_ok, _readiness_reason

    async with _readiness_lock:
        now = time.monotonic()
        if now - _readiness_checked_at < READINESS_TTL_SECONDS:
            return _readiness_ok, _readiness_reason
        try:
            data = await _call_jina(["readiness probe"], "query")
            embedding = data["data"][0]["embedding"]
            if not embedding or not all(isinstance(value, (int, float)) and math.isfinite(value) for value in embedding):
                raise ValueError("provider returned an invalid embedding")
            _readiness_ok = True
            _readiness_reason = "ready"
        except Exception as error:
            _readiness_ok = False
            _readiness_reason = type(error).__name__
            logger.warning("Jina readiness probe failed (%s)", _readiness_reason)
        _readiness_checked_at = time.monotonic()
        return _readiness_ok, _readiness_reason


@app.get("/health")
async def health():
    if not JINA_API_KEY:
        return {"status": "healthy", "service": "jina-proxy", "model": JINA_MODEL, "configured": False}
    return {"status": "healthy", "service": "jina-proxy", "model": JINA_MODEL, "configured": True}


@app.get("/live")
async def live():
    return {"status": "alive"}


@app.get("/ready")
async def ready():
    if not JINA_API_KEY:
        return JSONResponse(status_code=503, content={"status": "not ready", "detail": "JINA_API_KEY not set"})
    upstream_ok, _reason = await _check_upstream_readiness()
    if not upstream_ok:
        return JSONResponse(
            status_code=503,
            content={"status": "not ready", "detail": "Jina embeddings service unavailable"},
        )
    return {"status": "ready", "provider": "jina-cloud", "model": JINA_MODEL}


@app.get("/info")
async def info():
    return {
        "model": JINA_MODEL,
        "dimensions": 1024,
        "languages": "multilingual (60+ languages)",
        "task_types": ["query", "text-document"],
        "provider": "jina-cloud",
    }


@app.post("/embed", response_model=EmbedResponse)
async def embed(req: EmbedRequest):
    text = req.text or ""
    if len(text) > 50000:
        raise HTTPException(400, f"Text exceeds {50000} chars")
    if not JINA_API_KEY:
        raise HTTPException(503, "JINA_API_KEY not set; embeddings unavailable")

    data = await _call_jina([text], req.task_type or "query")
    embedding = data["data"][0]["embedding"]
    return EmbedResponse(embedding=embedding, dimensions=len(embedding))


@app.post("/embed/batch", response_model=BatchEmbedResponse)
async def embed_batch(req: BatchEmbedRequest):
    texts = req.texts or []
    if not texts:
        return BatchEmbedResponse(embeddings=[], dimensions=1024)
    for i, t in enumerate(texts):
        if len(t) > 50000:
            raise HTTPException(400, f"Text at index {i} exceeds {50000} chars")
    if not JINA_API_KEY:
        raise HTTPException(503, "JINA_API_KEY not set; batch embeddings unavailable")

    # Jina batch endpoint; split into chunks of 96 to stay under API limits
    CHUNK = 96
    all_embeddings = []
    for i in range(0, len(texts), CHUNK):
        chunk = texts[i:i + CHUNK]
        data = await _call_jina(chunk, req.task_type or "text-document")
        all_embeddings.extend(item["embedding"] for item in data["data"])

    dims = len(all_embeddings[0]) if all_embeddings else 1024
    return BatchEmbedResponse(embeddings=all_embeddings, dimensions=dims)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
