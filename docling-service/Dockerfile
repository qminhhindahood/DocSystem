# Docling PDF Parser Service
# Cloud Run is amd64; pin the platform manifest because cgr.dev's index digest
# is not consistently resolvable by remote BuildKit workers.
FROM cgr.dev/chainguard/wolfi-base@sha256:0a430fcad24f823d24783d019d7ff2c970aa4899c0e54f1f9de75f0382cf6b27 AS dependencies

ARG DOCLING_VERSION=2.109.0
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/opt/python \
    PATH=/opt/python/bin:/usr/local/sbin:/usr/local/bin:/usr/bin:/usr/sbin:/sbin:/bin \
    DOCLING_ARTIFACTS_PATH=/opt/docling/models \
    HF_HOME=/opt/docling/huggingface \
    HOME=/tmp \
    XDG_CACHE_HOME=/tmp/.cache

RUN apk add --no-cache \
      python-3.11 \
      py3.11-pip \
      libstdc++ \
      libgomp \
      tesseract \
      tesseract-vie \
      tesseract-eng \
      mesa-gl \
      glib

WORKDIR /app
COPY requirements.txt .
RUN python3.11 -m pip install --no-cache-dir --target=/opt/python \
      --extra-index-url https://download.pytorch.org/whl/cpu \
      -r requirements.txt
RUN test "$(python3.11 -c 'from importlib.metadata import version; print(version("docling"))')" = "${DOCLING_VERSION}"

COPY main.py self_test.py ./

RUN mkdir -p /app/uploads /opt/docling/models /opt/docling/huggingface \
    && docling-tools models download --output-dir /opt/docling/models layout tableformer rapidocr \
    && chmod -R a+rX /opt/docling \
    && chown -R 65532:65532 /app/uploads

# Fail the image build unless the pinned Docling package can perform a real conversion.
RUN python3.11 self_test.py --output /app/image-self-test.json

FROM cgr.dev/chainguard/wolfi-base@sha256:0a430fcad24f823d24783d019d7ff2c970aa4899c0e54f1f9de75f0382cf6b27 AS runtime

ARG BUILD_DATE=unknown
ARG VCS_REF=unknown
ARG DOCLING_VERSION=2.109.0
LABEL org.opencontainers.image.title="LLM Docling Service" \
      org.opencontainers.image.version="2.0.0-docling-${DOCLING_VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      io.llm.docling.version="${DOCLING_VERSION}" \
      io.llm.python.base.digest="sha256:0a430fcad24f823d24783d019d7ff2c970aa4899c0e54f1f9de75f0382cf6b27" \
      io.llm.self-test="python3.11 /app/self_test.py"

ENV PYTHONUNBUFFERED=1 \
    PYTHONPATH=/opt/python \
    PATH=/opt/python/bin:/usr/local/sbin:/usr/local/bin:/usr/bin:/usr/sbin:/sbin:/bin \
    DOCLING_ARTIFACTS_PATH=/opt/docling/models \
    HF_HOME=/opt/docling/huggingface \
    HOME=/tmp \
    XDG_CACHE_HOME=/tmp/.cache

RUN apk add --no-cache \
      python-3.11-base \
      libstdc++ \
      libgomp \
      tesseract \
      tesseract-vie \
      tesseract-eng \
      mesa-gl \
      glib

WORKDIR /app
COPY --from=dependencies /opt/python /opt/python
COPY --from=dependencies /opt/docling /opt/docling
COPY --from=dependencies --chown=65532:65532 /app /app

USER 65532:65532
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD ["/usr/bin/python3.11", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8001/ready', timeout=5)"]

ENTRYPOINT ["/usr/bin/python3.11", "-m", "uvicorn"]
CMD ["main:app", "--host", "0.0.0.0", "--port", "8001"]
