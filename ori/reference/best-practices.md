# Critical Recommendations & Best Practices

> Current backend note: Python snippets in this file are conceptual unless they target the Python microservices. Core API examples should be implemented in Express/TypeScript using `CURRENT_BACKEND_CONTRACT.md`, and production security requirements are centralized in `SECURITY_BASELINE.md`.

## 1. Vietnamese Text Normalization

Vietnamese diacritics can be inconsistent across documents. Normalize before embedding:

```python
import unicodedata

def normalize_vietnamese(text: str) -> str:
    """Normalize Vietnamese text: NFD -> NFC, fix common issues."""
    # Composed normalization
    text = unicodedata.normalize('NFC', text)

    # Fix common OCR errors
    replacements = {
        'oâ': 'ô',  # Common mis-scanned
        'uâ': 'ư',
        'sð': 's',
    }

    for wrong, correct in replacements.items():
        text = text.replace(wrong, correct)

    return text
```

Apply before chunking and embedding.

## 2. Decree 30/2020 Template Engine

Do NOT rely solely on LLM for format compliance. Use a template engine:

```python
# backend/services/template_engine.py
from jinja2 import Template
import re

DECREE30_TEMPLATES = {
    "cong_van": """CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do - Hạnh phúc
-------------------
Số: {{ so/ky_hieu }}

**V/v: {{ tieu_de }}**

Kính gửi: {{ nguoi_nhan }}

Về việc {{ ly_do }}, Căn cứ {{ can_cu_phap_ly }}, Ban hành văn bản này:

{% for khoan in noi_dung %}
{{ loop.index }}. {{ khoan }}
{% endfor %}

Nơi nhận:
- {{ nguoi_nhan }};
- Lưu: VT.

{{ nguoi_ky }}
({{ chuc_vu }})
""",
}

class Decree30Renderer:
    """Strict Decree 30/2020 formatter."""

    def render(self, doc_type: str, data: Dict) -> str:
        template_str = DECREE30_TEMPLATES[doc_type]
        template = Template(template_str)
        return template.render(**data)

    def validate(self, document: str) -> Dict[str, bool]:
        """Validate document compliance."""
        checks = {
            'has_header': bool(re.search(r'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', document)),
            'has_number': bool(re.search(r'Số:\s*\w+', document)),
            'has_date': bool(re.search(r',\s*ngày\s+\d+\s+tháng\s+\d+\s+năm', document)),
            'has_signature': bool(re.search(r'Ký tên', document)),
        }
        return checks
```

**Always run validation before presenting final document.**

## 3. RAG Quality Monitoring

Track RAG retrieval quality:

```python
# backend/services/rag_monitor.py
class RAGMonitor:
    """Monitor RAG effectiveness."""

    async def log_retrieval(
        self,
        query: str,
        results: List[Dict],
        user_actions: List[str]  # Which results user clicked/used
    ):
        """Log retrieval for analysis."""
        metrics = {
            'query': query,
            'num_results': len(results),
            'avg_similarity': sum(r['score'] for r in results) / len(results) if results else 0,
            'click_through_rate': len(user_actions) / len(results) if results else 0,
            'top_result_score': results[0]['score'] if results else 0,
        }

        await db.rag_metrics.create(data=metrics)

    def analyze_query_failures(self) -> List[Dict]:
        """Find queries with poor RAG results."""
        failures = await db.rag_metrics.find_many(
            where={
                'top_result_score': {'lt': 0.6},
                'click_through_rate': {'lt': 0.1}
            }
        )
        return failures
```

## 4. Rate Limiting & Concurrency

With Ollama local, limit concurrent requests:

```python
# backend/middleware/rate_limit.py
import asyncio
from collections import defaultdict

class ConcurrencyLimiter:
    """Limit concurrent Ollama calls (8GB VRAM max 2-3 concurrent)."""

    def __init__(self, max_concurrent: int = 2):
        self.semaphore = asyncio.Semaphore(max_concurrent)

    async def run(self, func, *args, **kwargs):
        async with self.semaphore:
            return await func(*args, **kwargs)
```

## 5. Document Versioning

Self-learning needs version control to prevent degradation:

```python
# backend/services/version_control.py
class VersionControl:
    """Track document versions and A/B test improvements."""

    async def create_version(
        self,
        doc_id: str,
        content: str,
        source: str,  # 'generated' or 'user_approved'
        metadata: Dict
    ):
        """Create new version with full history."""
        version = await db.document_version.create(
            data={
                'documentId': doc_id,
                'content': content,
                'source': source,
                'metadata': metadata,
                'createdAt': datetime.now()
            }
        )

        # Rollback if user-approved version has lower quality than previous
        if source == 'user_approved':
            await self._check_for_degradation(doc_id, version)

        return version

    async def _check_for_degradation(self, doc_id: str, new_version):
        """Compare quality metrics."""
        prev_versions = await db.document_version.find_many(
            where={'documentId': doc_id},
            order={'createdAt': 'desc'},
            take=2
        )

        if len(prev_versions) < 2:
            return

        # Compare format compliance
        new_score = self._format_score(new_version.content)
        prev_score = self._format_score(prev_versions[1].content)

        if new_score < prev_score - 0.2:  # >20% degradation
            # Flag for review, don't use for training
            await db.document_version.update(
                where={'id': new_version.id},
                data={'metadata': {**new_version.metadata, 'degraded': True}}
            )
```

## 6. Security Considerations

1. **File Upload Validation**
```python
# Validate PDF magic bytes
def validate_pdf(file_bytes: bytes) -> bool:
    return file_bytes[:4] == b'%PDF'
```

2. **SQL Injection Prevention**
   - Use Prisma ORM (already parameterized)
   - Never concatenate user input into queries

3. **Input Sanitization**
```python
import html
def sanitize_input(text: str) -> str:
    return html.escape(text)[:10000]  # Limit length, escape HTML
```

4. **Authentication**
```python
# backend/middleware/auth.py
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer

security = HTTPBearer()

async def verify_token(credentials = Depends(security)):
    token = credentials.credentials
    # Verify against your auth system
    user = await verify_jwt(token)
    if not user:
        raise HTTPException(401, "Unauthorized")
    return user
```

## 7. Performance Optimization

### Database Indexes
```sql
-- For faster similarity search
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops);

-- For filtering by type
CREATE INDEX IF NOT EXISTS idx_chunks_type ON chunks(chunkType);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(docType);

-- For time-based queries
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(createdAt);
```

### Connection Pooling
```python
# backend/prisma.ts or .env
DATABASE_URL="postgresql://...?connection_limit=20&pool_timeout=10"
```

### Caching Layer (Redis)
```python
import aioredis
from typing import Optional

class Cache:
    def __init__(self):
        self.redis = aioredis.from_url("redis://localhost:6379")

    async def get_rag_results(self, query: str, doc_type: str) -> Optional[List]:
        key = f"rag:{hash(query + doc_type)}"
        data = await self.redis.get(key)
        return json.loads(data) if data else None

    async def set_rag_results(self, query: str, doc_type: str, results: List, ttl: int = 3600):
        key = f"rag:{hash(query + doc_type)}"
        await self.redis.setex(key, ttl, json.dumps(results))
```

## 8. Testing Strategy

### Unit Tests
```python
# backend/tests/test_chunker.py
def test_hierarchical_chunking():
    chunker = LegalDocumentChunker()
    doc = load_sample_document()
    chunks = chunker.chunk_document(doc)

    # Verify hierarchy
    assert len(chunks) > 0
    assert all(c.level >= 0 and c.level <= 5 for c in chunks)

    # Verify parent-child relationships
    articles = [c for c in chunks if c.chunk_type == 'article']
    for article in articles:
        children = [c for c in chunks if c.metadata.get('parent_id') == article.id]
        assert len(children) > 0  # Every article should have children
```

### Integration Tests
```python
# backend/tests/test_workflow.py
@pytest.mark.asyncio
async def test_full_workflow():
    orchestrator = AgentOrchestrator(rag_service, ollama_service)

    result = []
    async for update in orchestrator.execute_workflow(
        user_request="Soạn thảo công văn báo cáo",
        doc_type="cong_van"
    ):
        result.append(update)

    assert result[-1]['phase'] == 'complete'
    assert result[-1]['status'] == 'success'
```

### End-to-End Tests
```bash
# Use Playwright for frontend E2E
npx playwright test tests/e2e/generation.spec.ts
```

## 9. Deployment Checklist

- [ ] PostgreSQL + pgvector installed and indexed
- [ ] Ollama running with Qwen3.6-14B loaded
- [ ] Docling service healthy on port 8001
- [ ] Redis for state caching (optional but recommended)
- [ ] Backend Express server on port 3001
- [ ] Frontend Next.js on port 3000
- [ ] CORS configured for frontend origin
- [ ] Nginx reverse proxy setup for production
- [ ] SSL certificates installed
- [ ] Backup strategy for PostgreSQL and RAG data
- [ ] Monitoring: GPU usage, RAM, disk space
- [ ] Log rotation configured

## 10. Common Pitfalls & Solutions

| Issue | Solution |
|-------|----------|
| OOM errors | Reduce `num_gpu_layers` to 28-32, use 4-bit quantization, or upgrade to RTX 4090 (24GB) for Qwen3.6-35B |
| Slow RAG queries | Create HNSW index, limit search to top 100 candidates |
| Poor Vietnamese output | Ensure prompt is in Vietnamese, add examples in system prompt |
| Docling table extraction fails | Enable `do_table_structure = True` in pipeline options |
| Streaming freezes | Use chunked transfer encoding, disable buffering in nginx |
| Feedback loop degradation | Implement version control and quality checks (see above) |
| Long context overflow | Use `num_ctx 8192` for Qwen3.6, implement context truncation |

## 11. Maintenance Tasks

1. **Daily**: Monitor disk space (RAG grows), check Ollama health
2. **Weekly**: Review feedback stats, clear old sessions from Redis
3. **Monthly**: Reindex pgvector if data changes significantly, backup database
4. **Quarterly**: Evaluate need for fine-tuning based on feedback accumulation

## 12. Scaling Considerations

When scaling beyond single server:

1. **Ollama Cluster**: Use `ollama-remote` or `openai-compatible` API with load balancer
2. **Database**: Read replicas for RAG queries, connection pool tuning
3. **Microservices**: Split Docling service to separate machine with more RAM
4. **Queue**: Add Redis queue for generation requests (Celery or Bull)
5. **Storage**: Move uploads to S3-compatible object storage
