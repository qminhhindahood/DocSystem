FROM python:3.11-slim-bookworm@sha256:d29f48a31a8b408ed19272ca1e7b10ebae13b240a27e862d3d4217c528e2e0c3

ARG EMBEDDING_MODEL_ID=jinaai/jina-embeddings-v5-text-small
ARG EMBEDDING_MODEL_REVISION=dd76d535f5447ca3897a9c893fb1e612ead98192
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="LLM Local Embeddings Service" \
      org.opencontainers.image.version="1.0.0-jina-v5" \
      org.opencontainers.image.revision="${VCS_REF}" \
      io.llm.embedding.model="${EMBEDDING_MODEL_ID}" \
      io.llm.embedding.revision="${EMBEDDING_MODEL_REVISION}" \
      io.llm.python.base.digest="sha256:d29f48a31a8b408ed19272ca1e7b10ebae13b240a27e862d3d4217c528e2e0c3"

ENV EMBEDDING_MODEL_ID=${EMBEDDING_MODEL_ID} \
    EMBEDDING_MODEL_REVISION=${EMBEDDING_MODEL_REVISION} \
    EMBEDDING_MODEL_CACHE_DIR=/models/huggingface/hub \
    EMBEDDING_MODEL_LOCAL_FILES_ONLY=false \
    HF_HOME=/models/huggingface \
    HF_HUB_CACHE=/models/huggingface/hub \
    SENTENCE_TRANSFORMERS_HOME=/models/huggingface/hub \
    HOME=/tmp \
    XDG_CACHE_HOME=/tmp/.cache \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install current Debian security updates, then remove package-manager metadata.
RUN apt-get update \
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir \
      --index-url https://download.pytorch.org/whl/cpu \
      torch==2.8.0
RUN pip install --no-cache-dir -r requirements.txt
RUN python -m pip uninstall --yes pip setuptools wheel

# Pin and pre-download Jina v5 remote code. Weights populate the persistent cache
# on first start unless operators bake or pre-seed the same immutable revision.
RUN python -c "import os; from huggingface_hub import snapshot_download; cache=os.environ['EMBEDDING_MODEL_CACHE_DIR']; snapshot_download(os.environ['EMBEDDING_MODEL_ID'], revision=os.environ['EMBEDDING_MODEL_REVISION'], cache_dir=cache, allow_patterns=['*.py', '*.txt', '*.json', '*.md'], ignore_patterns=['*.bin', '*.safetensors', '*.onnx'])"

# Copy application code
COPY . .

RUN mkdir -p /models /tmp/.cache \
    && chown -R 65532:65532 /models /tmp/.cache /app

EXPOSE 8002

VOLUME ["/models"]

USER 65532:65532

HEALTHCHECK --interval=30s --timeout=10s --start-period=300s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8002/ready', timeout=5)"]

CMD ["sh", "-c", "python prefetch_models.py && export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 && exec uvicorn main:app --host 0.0.0.0 --port 8002"]
