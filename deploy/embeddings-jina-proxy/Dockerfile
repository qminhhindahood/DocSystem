FROM python:3.11-alpine@sha256:25976e9d34a0fab1f278cae931f34c8303d97bf0c0d7f85b6b4dcf641d7702a4 AS dependencies
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1
WORKDIR /build
COPY requirements.txt .
RUN python -m pip install --no-cache-dir --target=/opt/python -r requirements.txt

FROM python:3.11-alpine@sha256:25976e9d34a0fab1f278cae931f34c8303d97bf0c0d7f85b6b4dcf641d7702a4 AS runtime
LABEL org.opencontainers.image.title="LLM Jina Embeddings Proxy" \
      org.opencontainers.image.version="1.0.0"
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/opt/python
WORKDIR /app
RUN addgroup -S -g 10001 app \
    && adduser -S -D -H -u 10001 -G app app \
    && python -m pip uninstall --yes pip setuptools wheel
COPY --from=dependencies /opt/python /opt/python
COPY main.py .
USER 10001:10001
EXPOSE 8002
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8002/ready', timeout=5)"]
CMD ["python", "main.py"]
