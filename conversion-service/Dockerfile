# conversion-service — PDF -> DOCX (Direction 1)
# Lightweight: no GPU, no heavy local ML models (vision runs on Gemini Flash).
# Target: < 512 MB RAM at runtime.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Service code
COPY conversion-service/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY conversion-service/ /app/
# Canonical typography source (single source of truth, plan §8)
COPY shared/ /shared/

ENV DECREE30_TYPOGRAPHY_PATH=/shared/decree30-typography.json \
    CONVERSION_WORK_DIR=/app/work \
    CONVERSION_PORT=8004

RUN useradd -m appuser && mkdir -p /app/work && chown -R appuser /app
USER appuser

EXPOSE 8004

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8004/health', timeout=3)" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8004"]
