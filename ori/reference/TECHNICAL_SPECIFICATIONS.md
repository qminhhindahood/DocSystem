# AI Document System - Technical Specifications

## Complete System Configuration Reference

> Current implementation notes: use `CURRENT_BACKEND_CONTRACT.md` for Express/TypeScript backend routes and `SECURITY_BASELINE.md` for mandatory production security requirements.

**Project**: Vietnamese Government Document AI System (Decree 30/2020 Compliance)
**Version**: 2.0 (Qwen3.6 Updated)
**Last Updated**: May 2026

---

## 1. Hardware Specifications

### Primary Configuration (RTX 5060 8GB VRAM)
| Component | Specification |
|-----------|---------------|
| GPU | NVIDIA RTX 5060 |
| VRAM | 8GB |
| CUDA Cores | ~3072 |
| System RAM | 16GB minimum, 32GB recommended |
| Storage | 50GB SSD minimum (for models + database) |

### Upgrade Path (For Qwen3.6-35B)
| Component | Specification |
|-----------|---------------|
| GPU | NVIDIA RTX 4090 |
| VRAM | 24GB |
| System RAM | 64GB |
| Storage | 100GB NVMe SSD |

---

## 2. Model Configuration

### Primary Model: Qwen3.6-14B
```
Model Name: Qwen/Qwen3.6-14B
Architecture: Transformer decoder-only
Parameters: 14 billion
Context Window: 128K tokens (supported), 8192 (recommended for 8GB VRAM)
Quantization: 4-bit (GGUF/Q4_K_M)
Language Support: Vietnamese (optimized), English, Chinese

VRAM Usage:
- 4-bit quantization: ~6-7GB
- GPU Layers: 32-35 offloaded
- Batch Size: 512 tokens
```

### Ollama Configuration
```bash
# Environment variables for /etc/ollama/ollama.service
OLLAMA_GPU_LAYERS=35
OLLAMA_MAX_LOADED_MODELS=1
OLLAMA_NUM_PARALLEL=1
CUDA_VISIBLE_DEVICES=0
OLLAMA_CONTEXT_LENGTH=8192
```

### Modelfile Parameters
```dockerfile
FROM qwen3.6:14b
PARAMETER num_ctx 8192
PARAMETER num_batch 512
PARAMETER num_gqa 16
PARAMETER num_gpu_layers 35
PARAMETER temperature 0.3
PARAMETER top_p 0.9
PARAMETER repeat_penalty 1.1
```

### Alternative Models
| Model | VRAM Required | Use Case |
|-------|---------------|----------|
| Qwen3.6-7B | ~4GB | Light duty, faster inference |
| Qwen3.6-35B | ~20GB+ | Full capabilities (needs RTX 4090) |
| Gemma 2 9B | ~6GB | English-first projects |

---

## 3. System Architecture

### Component Map
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Frontend      │────│   Backend API    │────│  Ollama (GPU)  │
│   Next.js 14    │    │   Express.js     │    │  Qwen3.6-14B   │
│   Port: 3000    │    │   Port: 3001     │    │  Port: 11434   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │
         │              ┌────────▼────────┐
         │              │   PostgreSQL    │
         │              │  + pgvector     │
         │              │  Port: 5432     │
         │              └─────────────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐    ┌──────────────────┐
│   Docling       │    │   Redis Cache    │
│   FastAPI       │    │  Port: 6379      │
│   Port: 8001    │    │                  │
└─────────────────┘    └──────────────────┘
```

### Service Ports Reference
| Service | Port | Protocol |
|---------|------|----------|
| Next.js Frontend | 3000 | HTTP |
| Express Backend | 3001 | HTTP |
| PostgreSQL | 5432 | TCP |
| Docling Service | 8001 | HTTP |
| Redis | 6379 | TCP |
| Ollama | 11434 | HTTP |

---

## 4. Database Schema (Prisma)

### Core Tables

```prisma
model Document {
  id           String   @id @default(cuid())
  filename     String
  originalPath String
  docType      String   // "thue", "quyetdinh", "nghi_dinh", etc.
  metadata     Json?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  chunks       Chunk[]
  templates    Template[]
}

model Chunk {
  id          String   @id @default(cuid())
  documentId  String
  content     String
  embedding   Float[]? // pgvector vector(384) or vector(1024)
  metadata    Json?    // {article, clause, level, pageNum}
  chunkType   String   // "article", "clause", "point", "content"
  chunkIndex  Int
  createdAt   DateTime @default(now())
  document    Document @relation(fields: [documentId], references: [id])
  
  @@index([embedding], type: hnsw, ops: vector_cosine_ops)
  @@index([documentId])
  @@index([chunkType])
}

model Template {
  id        String   @id @default(cuid())
  name      String
  docType   String
  content   String   // Jinja2 template
  structure Json?
  version   Int      @default(1)
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Feedback {
  id              String   @id @default(cuid())
  sessionId       String
  generatedContent Json
  editedContent   String
  editType        String   // "minor", "wording", "structural", "legal", "formatting"
  similarity      Float
  user_id         String?
  createdAt       DateTime @default(now())
  
  @@index([editType])
  @@index([createdAt])
}

model FineTuneExample {
  id       String   @id @default(cuid())
  prompt   String
  response String
  tone     String   // "authoritative", "precise", "legal"
  structure Json?
  createdAt DateTime @default(now())
}
```

### Database Extensions
```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable vector extension for PostgreSQL
ALTER SYSTEM SET shared_preload_libraries = 'vector';
```

### Index Creation (Post-Deployment)
```sql
-- HNSW index for faster similarity search
CREATE INDEX IF NOT EXISTS idx_chunks_embedding 
ON chunks USING hnsw (embedding vector_cosine_ops);

-- Type filtering indexes
CREATE INDEX IF NOT EXISTS idx_chunks_type ON chunks(chunkType);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(docType);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(createdAt);
```

---

## 5. RAG Configuration

### Embedding Model: Jina Embeddings V3 (Recommended)

```
Model: jinaai/jina-embeddings-v3
Dimensions: 1024
Context Window: 8192 tokens
Languages: 97+ (excellent Vietnamese support)
License: Apache 2.0

Advantages:
- Task-aware embeddings (separate query/doc modes)
- 8192 token context enables larger chunks
- Superior Vietnamese benchmarks (+10% vs E5-Large)
- Better legal document retrieval (+15% accuracy)

Installation:
  pip install -U sentence-transformers
  python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('jinaai/jina-embeddings-v3')"
```

### Alternative: multilingual-e5-large-instruct

```
Model: intfloat/multilingual-e5-large-instruct
Dimensions: 1024
Context Window: 512 tokens
Languages: 50+

Note: Solid alternative if Jina V3 is unavailable.
```

### RAG Search Parameters (Optimized for Jina V3)

```python
TOP_K = 15                    # Increased from 10 (better retrieval allows more results)
SIMILARITY_THRESHOLD = 0.65   # Lowered from 0.7 (better embeddings = tighter clustering)
RE_RANK enabled = True        # Hierarchical re-ranking

# Chunk size optimized for 8192 token context
MAX_CHUNK_SIZE = 4000         # Characters (can go up to 8000)
MERGE_THRESHOLD = 0.8         # Aggressive merging for context preservation

Hierarchy Weights:
- document: 1.2
- chapter: 1.1
- article: 1.15
- clause: 1.0
- point: 0.9
- content: 1.0
```

### Embedding Service Implementation

```python
# backend/services/embedding.py
from sentence_transformers import SentenceTransformer
import torch

class EmbeddingService:
    MODEL_NAME = "jinaai/jina-embeddings-v3"
    DIMENSIONS = 1024
    
    def __init__(self):
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        self.model = SentenceTransformer(self.MODEL_NAME, device=device)
    
    def embed_query(self, text: str) -> List[float]:
        """Embed query with task-aware mode."""
        return self.model.encode(
            text, task_type='query', normalize_embeddings=True
        ).tolist()
    
    def embed_document(self, text: str) -> List[float]:
        """Embed document with task-aware mode."""
        return self.model.encode(
            text, task_type='text-document', normalize_embeddings=True
        ).tolist()
```

### Performance Expectations

| Metric | MiniLM (Old) | Jina V3 (New) | Improvement |
|--------|--------------|---------------|-------------|
| Vietnamese STS | 68.5% | 72.3% | +5.5% |
| Vietnamese Retrieval | 65.2% | 69.8% | +7.0% |
| Legal Document QA | 66.8% | 71.2% | +6.6% |
| RAG Accuracy | ~70% | ~87% | +24% |

---

## 6. Agent Workflow Configuration

### Agent Roles
| Agent | Role | Temperature | Purpose |
|-------|------|-------------|---------|
| Planner | Document structure planning | 0.2 | Analyze request, determine document type |
| Researcher | Legal basis retrieval | 0.1 | Find relevant laws via RAG |
| Writer | Document generation | 0.3 | Generate final document |

### Workflow Phases
```
1. PLANNING (30-60s)
   - Parse user request
   - Determine document type
   - Generate structure outline
   
2. RESEARCH (10-30s)
   - Query RAG for legal basis
   - Extract relevant citations
   - Build context for writer
   
3. WRITING (30-60s)
   - Generate document content
   - Stream tokens to frontend
   - Validate format compliance
```

### State Management (Redis)
```python
REDIS_TTL = 3600  # Session timeout (1 hour)
STATE_KEY_PREFIX = "workflow:"
```

---

## 7. Docling PDF Parser Configuration

### Pipeline Options
```python
pipeline_options = PdfPipelineOptions()
pipeline_options.do_ocr = True
pipeline_options.do_table_structure = True
pipeline_options.table_structure_options.do_cell_matching = True

# Backend selection
backend = PyPdfiumDocumentBackend
```

### Port: 8001

### Docker Memory Limit
```yaml
deploy:
  resources:
    limits:
      memory: 4G
```

---

## 8. Decree 30/2020 Template Engine

### Required Document Elements
```
1. Header: "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM"
2. Motto: "Độc lập - Tự do - Hạnh phúc"
3. Document Number: "Số: [number]/[type]"
4. Title: "V/v: [subject]"
5. Recipient: "Kính gửi: [recipient]"
6. Content Sections (numbered)
7. "Nơi nhận:" section
8. Date/Place: "[City], ngày X tháng Y năm Z"
9. Signature block (name, position)
10. Official stamp location
```

### Validation Regex Patterns
```python
PATTERNS = {
    'header': r'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM',
    'motto': r'Độc lập - Tự do - Hạnh phúc',
    'number': r'Số:\s*\S+',
    'date': r',\s*ngày\s+\d+\s+tháng\s+\d+\s+năm\s+\d+',
    'signature': r'(Ký tên|Chữ ký)',
    'recipient': r'Kính gửi:',
    'notes': r'Nơi nhận:',
}
```

---

## 9. LoRA Fine-Tuning Configuration

### Training Parameters
```python
MODEL_NAME = "Qwen/Qwen3.6-14B"
MAX_SEQ_LENGTH = 8192
LOAD_IN_4BIT = True

# LoRA hyperparameters
LORA_R = 16
LORA_ALPHA = 32
LORA_DROPOUT = 0.1
LORA_TARGET_MODULES = [
    "q_proj", "k_proj", "v_proj", "o_proj",
    "gate_proj", "up_proj", "down_proj"
]

# Training hyperparameters
LEARNING_RATE = 2e-4
NUM_EPOCHS = 3
BATCH_SIZE = 1
GRADIENT_ACCUMULATION = 8
WARMUP_RATIO = 0.1
LR_SCHEDULER = "cosine"
BF16 = True
```

### Training Data Requirements
| Stage | Examples | Purpose |
|-------|----------|---------|
| Minimum | 500 | Baseline fine-tuning |
| Target | 2,000-5,000 | Good coverage |
| Maximum | 10,000 | Diminishing returns |

### Continuous Fine-Tuning Trigger
```
Minimum examples per edit type: 50
Check frequency: Weekly (cron: 0 2 * * 0)
```

---

## 10. Frontend Configuration

### Technology Stack
| Layer | Technology | Version |
|-------|------------|---------|
| Framework | Next.js | 14+ (App Router) |
| Language | TypeScript | Latest |
| Styling | Tailwind CSS | 3.x |
| State | TanStack Query | 5.x |
| Editor | Monaco Editor | Latest |
| Upload | react-dropzone | Latest |

### API Configuration
```typescript
// frontend/lib/api.ts
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

axios.create({
  baseURL: API_BASE,
  timeout: 300000,  // 5 minutes for generation
  headers: { 'Content-Type': 'application/json' }
});
```

### Required Dependencies
```json
{
  "dependencies": {
    "axios": "^1.x",
    "@tanstack/react-query": "^5.x",
    "react-dropzone": "^14.x",
    "@monaco-editor/react": "^4.x"
  },
  "devDependencies": {
    "@types/node": "latest",
    "tailwindcss": "^3.x"
  }
}
```

---

## 11. Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| PDF Parse Time | < 30s | 10 page document |
| Generation Time | 60-90s | Full document |
| RAG Query Latency | < 200ms | Top 10 results |
| VRAM Usage | < 7GB | Qwen3.6-14B 4-bit |
| Document Accuracy | >85% | Decree 30/2020 compliance |
| Concurrent Users | 2-3 | Limited by 8GB VRAM |

---

## 12. Environment Variables

### Backend (.env)
```env
DATABASE_URL="postgresql://airabbit:<strong-password>@localhost:5432/airabbit"
JWT_SECRET="<at-least-32-random-bytes>"
REGISTRATION_INVITE_CODE="<random-invite-code>"
OLLAMA_URL="http://localhost:11434"
REDIS_URL="redis://localhost:6379"
DOCLING_URL="http://localhost:8001"
EMBEDDINGS_URL="http://localhost:8002"
CLAMAV_HOST="localhost"
CLAMAV_PORT="3310"
OLLAMA_MODEL="qwen3.6:14b"
NODE_ENV="development"
```

### Frontend (.env.local)
```env
NEXT_PUBLIC_API_URL="http://localhost:3001/api"
```

### Ollama (/etc/ollama/ollama.service)
```ini
[Service]
Environment="OLLAMA_GPU_LAYERS=35"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="CUDA_VISIBLE_DEVICES=0"
Environment="OLLAMA_CONTEXT_LENGTH=8192"
```

---

## 13. Docker Compose Configuration

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg15
    environment:
      POSTGRES_DB: airabbit
      POSTGRES_USER: airabbit
      POSTGRES_PASSWORD: ${DB_PASSWORD:?DB_PASSWORD is required}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "5432:5432"
    command: ["postgres", "-c", "shared_preload_libraries=vector"]

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  docling:
    build: ./docling-service
    ports:
      - "8001:8001"
    volumes:
      - ./uploads:/app/uploads
    deploy:
      resources:
        limits:
          memory: 4G

  embeddings:
    build: ./embeddings-service
    ports:
      - "8002:8002"

  clamav:
    image: clamav/clamav:stable
    ports:
      - "3310:3310"

volumes:
  postgres_data:
  redis_data:
```

---

## 14. Security Configuration

### File Upload Validation
Required controls are documented in `SECURITY_BASELINE.md`: file size limit, `.pdf` extension check, `%PDF-` magic-byte validation, and virus scanning before parsing or indexing.

### Input Sanitization
Validate all route params, query strings, request bodies, and upload metadata with schemas before calling services.

### Authentication (Required)
All API routes except health and auth entry points require JWT bearer authentication. Registration must be invite-code protected.

---

## 15. Monitoring & Maintenance

### Daily Tasks
- Monitor disk space (RAG grows over time)
- Check Ollama health: `curl http://localhost:11434/api/tags`
- Review error logs

### Weekly Tasks
- Review feedback statistics
- Clear old sessions from Redis
- Check GPU temperature/throttling

### Monthly Tasks
- Reindex pgvector if data changes significantly
- Full database backup
- Review performance metrics

### Quarterly Tasks
- Evaluate need for LoRA fine-tuning
- Review and update training examples
- Audit Decree 30/2020 compliance rates

---

## 16. Troubleshooting Reference

| Issue | Symptom | Solution |
|-------|---------|----------|
| OOM Error | "CUDA out of memory" | Reduce `num_gpu_layers` to 28, or upgrade GPU |
| Slow RAG | Queries taking >500ms | Create HNSW index, limit top_k to 10 |
| Poor Vietnamese | Garbled output | Verify prompt is in Vietnamese, check tokenizer |
| Docling Tables | Missing table data | Enable `do_table_structure = True` |
| Streaming Freeze | UI hangs mid-generation | Disable nginx buffering, check chunked encoding |
| Format Errors | Decree 30/2020 non-compliant | Run template validation before export |

---

## 17. Resource Links

| Resource | URL |
|----------|-----|
| Qwen3.6 Model | https://huggingface.co/Qwen/Qwen3.6 |
| Qwen GitHub | https://github.com/QwenLM/Qwen3.6 |
| Ollama | https://github.com/ollama/ollama |
| Docling | https://github.com/DS4SD/docling |
| pgvector | https://github.com/pgvector/pgvector |
| Unsloth | https://unsloth.ai |
| Decree 30/2020 | Official Vietnamese government publication |
