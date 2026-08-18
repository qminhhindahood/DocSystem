# AI Document System for Vietnamese Government (Decree 30/2020)

> Note: These are original planning documents. Use `reference/CURRENT_BACKEND_CONTRACT.md` and `reference/SECURITY_BASELINE.md` as the source of truth when older phase snippets drift from the current TypeScript/Express backend.

## Executive Summary

A complete, production-ready architecture for building an internal AI system that:
- Reads and understands PDF documents from the Education sector
- Plans document processing workflows using agentic AI
- Generates Word documents adhering to Decree 30/2020 administrative standards
- Continuously self-learns from user edits via feedback loops

**Architecture**: Local-first, no external APIs, using RTX 5060 (8GB VRAM) + Qwen3.6-14B via Ollama.

**Model Recommendation**: Qwen3.6-35B vs Gemma 4 comparison:
- **Qwen3.6-35B (A3B MoE)**: Superior Vietnamese support, 128K context, better document generation
- **Gemma 4**: Weaker Vietnamese language support, smaller context windows
- **For 8GB VRAM**: Use Qwen3.6-14B (fits comfortably) or upgrade to RTX 4090 (24GB) for full Qwen3.6-35B

---

## Quick Start Checklist

### Phase 1: Infrastructure
- [ ] Install NVIDIA drivers, verify with `nvidia-smi`
- [ ] Install Ollama, pull `qwen3.6:14b`
- [ ] Configure GPU offloading: `OLLAMA_GPU_LAYERS=32`
- [ ] Setup PostgreSQL + pgvector
- [ ] Initialize backend Express.js + TypeScript

### Phase 2: PDF Parsing
- [ ] Setup Docling microservice (Python FastAPI)
- [ ] Test with sample Vietnamese PDFs
- [ ] Verify table and layout extraction

### Phase 3: RAG System
- [ ] Implement hierarchical chunking (Article → Clause → Point)
- [ ] Generate embeddings and store in pgvector
- [ ] Create HNSW indexes for fast similarity search
- [ ] Test semantic search accuracy

### Phase 4: AI Engine
- [ ] Create custom Modelfile with Vietnamese state document system prompt
- [ ] Build Ollama service wrapper
- [ ] Implement streaming for real-time UX
- [ ] Configure context window management (128K for Qwen3.6)

### Phase 5: Agent Workflow
- [ ] Implement Planner → Researcher → Writer agents
- [ ] Setup state persistence (Redis)
- [ ] Add error recovery and retries
- [ ] Create Express/TypeScript endpoints

### Phase 6: Frontend
- [ ] Next.js + TypeScript setup
- [ ] Document upload with drag-drop
- [ ] Streaming generation panel
- [ ] Monaco editor integration
- [ ] Phase progress visualization

### Phase 7: Self-Learning
- [ ] Feedback capture on document save
- [ ] Diff computation and classification
- [ ] RAG update with approved versions
- [ ] Feedback dashboard for admins

### Phase 8: LoRA Fine-tuning (Optional but Recommended)
- [ ] Prepare 500+ training examples
- [ ] Install Unsloth and dependencies
- [ ] Run LoRA training on 8GB VRAM (Qwen3.6-14B with 4-bit quantization)
- [ ] Export to Ollama format
- [ ] Test fine-tuned model
- [ ] Setup continuous fine-tuning pipeline

---

## Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Frontend      │────│   Express.js     │────│  Ollama (GPU)  │
│   Next.js       │    │   Backend API    │    │  Qwen3.6-14B   │
│                 │    │                  │    │                 │
│  - Upload PDF   │    │  - Orchestrator  │    │  + LoRA Adapter│
│  - Generate UI  │    │  - RAG Service   │    │                 │
│  - Monaco Edit  │    │  - Prompt Mgmt   │    └─────────────────┘
└─────────────────┘    └──────────────────┘           │
         │                       │                     │
         │              ┌────────▼────────┐           │
         │              │   PostgreSQL    │◄──────────┘
         │              │  + pgvector     │
         │              │  - Documents    │
         │              │  - Chunks       │
         │              │  - Templates    │
         │              │  - Feedback     │
         │              └─────────────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐    ┌──────────────────┐
│   Docling       │    │   Redis Cache    │
│   Microservice  │    │  (State Store)   │
│                 │    │                  │
│  - PDF Parsing  │    └──────────────────┘
│  - Table Extract│
│  - Layout Presv │
└─────────────────┘
```

---

## Detailed Implementation Guides

Each phase is documented in separate files:

1. **[Phase 1: Infrastructure Setup](phases/phase-1-infrastructure.md)**
   - GPU configuration, Ollama setup, database initialization

2. **[Phase 2: PDF Parsing Microservice](phases/phase-2-docling.md)**
   - Docling configuration, Docker setup, Vietnamese text extraction

3. **[Phase 3: RAG System](phases/phase-3-rag.md)**
   - Hierarchical chunking strategy, pgvector schema, embedding service

4. **[Phase 4: Ollama Integration](phases/phase-4-ollama.md)**
   - Custom Modelfile, prompt templates, streaming implementation

5. **[Phase 5: Agent Workflow](phases/phase-5-workflow.md)**
   - Planner/Researcher/Writer agents, Express routes, state management

6. **[Phase 6: Frontend Application](phases/phase-6-frontend.md)**
   - Next.js setup, streaming UI, Monaco editor, TypeScript types

7. **[Phase 7: Self-Learning](phases/phase-7-feedback.md)**
   - Feedback capture, diff computation, RAG updates, admin dashboard

8. **[Phase 8: LoRA Fine-tuning](phases/phase-8-lora.md)**
   - Training data prep, Unsloth training, Ollama export, evaluation

9. **[Current Backend Contract](reference/CURRENT_BACKEND_CONTRACT.md)**
   - Current Express/TypeScript route, service, naming, and Prisma rules

10. **[Security Baseline](reference/SECURITY_BASELINE.md)**
   - Required auth, secrets, validation, upload, SQL, and readiness rules

11. **[Best Practices & Recommendations](reference/best-practices.md)**
   - Security, performance, testing, deployment checklist

---

## Key Design Decisions Explained

### Why Local LLM?
Government documents contain sensitive data. Commercial APIs (ChatGPT, Claude) send data to third parties. Ollama runs 100% on-premise.

### Why Qwen3.6-14B (vs Gemma 4)?

**Qwen3.6-35B (A3B MoE)** - Released early 2026 by Alibaba:
- **35B total parameters** with A3B (Adaptive Active Bottleneck) MoE architecture
- **Context window**: Up to 128K tokens
- **Vietnamese Language**: Significantly better training on Asian language corpora
- **Document Understanding**: Stronger performance on long-form administrative document tasks
- **Efficient Inference**: MoE design means fewer active parameters per token

**Gemma 4** - Google's latest (mid-2025 to early 2026):
- Various sizes (estimated 9B-27B range based on Gemma 2 lineage)
- Good English performance but weaker Vietnamese language support
- Smaller context windows typically (8K-32K)
- Less optimized for Asian language document generation

**Recommendation**: Qwen3.6 is clearly superior for Vietnamese government document systems.

**Hardware Considerations for RTX 5060 (8GB VRAM)**:
- Qwen3.6-35B with 4-bit quantization: ~20GB+ required (won't fit)
- **For 8GB VRAM**: Use Qwen3.6-14B (fits comfortably)
- **For Qwen3.6-35B**: Upgrade to RTX 4090 (24GB VRAM) or use cloud inference

### Why Custom Build vs Dify?
Full control over:
- Document-specific chunking (hierarchical, not semantic)
- Streaming UI for real-time preview
- Self-learning feedback loops
- Decree 30/2020 compliance validation
- Vietnamese-specific optimizations

### Why Docling?
Superior table extraction and layout preservation vs PyPDF2/pdfplumber. Critical for legal documents with multi-column layouts.

### Why Hierarchical RAG?
Legal documents have structure (Điều → Khoản → Điểm). Querying at the right level improves accuracy. Boost higher-level chunks in ranking.

---

## Decree 30/2020 Compliance

The system enforces Nghị định 30/2020/NĐ-CP on document format through:

1. **Template Engine**: Jinja2 templates for each document type
2. **Validator**: Schema and regex checks for required elements (Số, ngày/tháng/năm, ký tên)
3. **LLM Prompting**: System prompt enforces structure
4. **Post-processing**: Format correction before export

Required elements checked:
- Header: "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM"
- Document number: "Số: ..."
- Date/place: "Hà Nội, ngày X tháng Y năm Z"
- Content sections with numbered clauses
- Signature block with name, title, stamp location

---

## Self-Learning Pipeline

```
User Edits Document
        ↓
   Diff Computed
        ↓
  Edit Type Classified
        ↓
  ┌─────┴─────┐
  │           │
  ▼           ▼
Store      Add to RAG
Feedback   (User-approved)
  │
  ▼
Count Accumulates
  │
  ▼
≥50 Examples? ──No──→ Wait
  │ Yes
  ▼
Trigger LoRA Training
  │
  ▼
Deploy Fine-tuned Model
```

---

## Performance Targets

| Metric | Target |
|--------|--------|
| PDF Parse Time | < 30s (10 pages) |
| Generation Time | 60-90s (full doc) |
| RAG Query Latency | < 200ms |
| VRAM Usage | < 7GB (with 14B model, 4-bit) |
| Document Accuracy | >85% format compliance |

---

## Production Readiness

### Before Going Live

1. **Data Quality**
   - [ ] Seed RAG with at least 100 relevant PDFs
   - [ ] Generate 200+ training examples for LoRA
   - [ ] Validate Decree 30/2020 compliance on 50 test docs

2. **Infrastructure**
   - [ ] Backup strategy (PostgreSQL daily, S3 for uploads)
   - [ ] Monitoring (GPU/RAM metrics, logs)
   - [ ] SSL/TLS certificates
   - [ ] Nginx reverse proxy

3. **User Training**
   - [ ] Document how to provide feedback
   - [ ] Explain AI limitations
   - [ ] Review workflow documentation

4. **Testing**
   - [ ] Unit test coverage >70%
   - [ ] E2E test for full generation flow
   - [ ] Load test with 10 concurrent users

---

## Troubleshooting

### Ollama Out of Memory
```bash
# Reduce GPU layers for 8GB VRAM
OLLAMA_GPU_LAYERS=28 ollama run qwen3.6:14b

# Or use smaller model
ollama pull qwen3.6:7b

# For Qwen3.6-35B (requires 24GB+ VRAM):
# Upgrade to RTX 4090 or use cloud inference
```

### pgvector Similarity Not Working
```sql
-- Ensure extension is loaded
CREATE EXTENSION IF NOT EXISTS vector;

-- Recreate index with HNSW (better than IVFFLAT)
DROP INDEX IF EXISTS chunks_embedding_idx;
CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops);
```

### Docling Tables Missing
```python
# Ensure table structure detection is enabled
pipeline_options.do_table_structure = True
pipeline_options.table_structure_options.do_cell_matching = True
```

### Streaming Not Working in Production
- Disable nginx buffering: `proxy_buffering off;`
- Set headers: `X-Accel-Buffering: no`
- Use chunked transfer encoding

---

## Support & Resources

- **Ollama Docs**: https://github.com/ollama/ollama
- **Docling**: https://github.com/DS4SD/docling
- **pgvector**: https://github.com/pgvector/pgvector
- **Unsloth**: https://unsloth.ai
- **Qwen3.6**: https://huggingface.co/Qwen/Qwen3.6
- **Qwen3.6 GitHub**: https://github.com/QwenLM/Qwen3.6

---

## License

Internal government project. All code and documentation proprietary.

---

**Last Updated**: May 2026
**Version**: 2.0 (Updated for Qwen3.6)
