# AI Document System for Vietnamese Government

A production-ready AI system for generating administrative documents compliant with Decree 30/2020/NĐ-CP, using a local LLM (via LM Studio) and a full-stack architecture.

---

## Quick Start

### Prerequisites
- **GPU**: VRAM sufficient for your chosen model (check LM Studio requirements)
- **OS**: Windows 11 / Ubuntu 22.04
- **Tools**: Docker, Node.js 20+, Python 3.11+, .NET 10 SDK, LM Studio

### Setup Commands
```bash
# 1. Start LM Studio and load your model
#    - Open LM Studio
#    - Load your downloaded model
#    - Start the local server (default: http://localhost:1234)
#    - Note the server URL and model name for the .env file

# 2. Start infrastructure (PostgreSQL + pgvector + Redis + Docling + Embeddings + Renderer)
docker-compose up -d

# 3. Initialize backend
cd backend
npm install
npx prisma migrate deploy
npm run dev # Port 3001

# 4. Start frontend
cd frontend
npm install
npm run dev # Port 3000
```

---

## Architecture

The architecture consists of a Next.js frontend, an Express.js backend orchestrating various microservices, and local infrastructure including PostgreSQL and LM Studio.

### 1. High-Level Flow & Services

```
┌─────────────────────────────────────────────────────────────┐
│                   FRONTEND (Next.js :3000)                  │
│  ┌─────────────────────┐       ┌──────────────────────────┐ │
│  │  Upload PDF/DOCX    ├──────►│  Monaco Editor           │ │
│  └─────────────────────┘       │  Preview & Diff Viewer   │ │
└────────────────────────────────┬────────────────────────────┘
                                 │ HTTP/REST
                                 ▼
┌─────────────────────────────────────────────────────────────┐
│                 BACKEND (Express.js :3001)                  │
│                                                             │
│                      ┌──────────────┐                       │
│                      │ ORCHESTRATOR │                       │
│                      └──────┬───────┘                       │
│                             │                               │
│        ┌────────────┬───────┼──────────┬────────────┐       │
│        ▼            ▼       ▼          ▼            ▼       │
│   ┌────────┐   ┌─────────┐┌────────┐┌────────┐┌───────────┐ │
│   │  CMD   │   │ Extract ││  RAG   ││ Prompt ││    LLM    │ │
│   │ Parser │   │ Service ││ Service││ Builder││  Service  │ │
│   └────────┘   └─────────┘└────┬───┘└────────┘└─────┬─────┘ │
│                                │                    │       │
│   ┌────────────────┐           │                    ▼       │
│   │ Format Service │◄──────────┼────────────┌──────────────┐│
│   └────────────────┘           │            │  Validator   ││
│                                │            └──────────────┘│
│   ┌────────────────┐           │                            │
│   │ Feedback Service│ ◄────────┘                            │
│   └──────┬─────────┘                                        │
└──────────│──────────────────────────────────────────────────┘
           │ (>= 50 examples)
           ▼
┌─────────────────────────────────────────────────────────────┐
│                       INFRASTRUCTURE                        │
│  ┌──────────────────────┐  ┌─────────────────┐  ┌─────────┐ │
│  │ PostgreSQL + pgvector│  │  Redis (Cache/  │  │  LM     │ │
│  │ (Docs/Chunks/Configs)│  │  State/Queue)   │  │  Studio │◄┐
│  └──────────────────────┘  └─────────────────┘  └─────────┘ │
└──────────────────────────────────────────────────────────│──┘
                                                           │
┌──────────────────────────────────────────────────────────│──┘
│                   FINE-TUNING PIPELINE                   │
│  ┌───────────────────────────────────────────────────────┴┐ │
│  │ NeMo AutoModel (LoRA training & adapter hot-swap)      │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 2. Backend Architecture Breakdown

#### Orchestrator Workflow
The orchestrator manages the lifecycle of a document request:
1. Parse user command → intent + entities
2. Extract document (if file uploaded) → structured JSON
3. Retrieve context → legal refs + similar docs + org info
4. Build prompt → system + examples + context + command
5. Stage 1 → Generate outline (Điều titles)
6. Stage 2 → Fill content (Khoản + Điểm)
7. Validate output → fix errors or regenerate
8. Format → DOCX via template

#### Core Services
- **CMD Parser**: Extracts keywords and entities from user requests.
- **Extract Service**: Converts PDF via Docling (OCR if needed) or DOCX via MarkItDown into **Structured JSON**.
- **RAG Service**: Retrieves legal references, full document examples, organization info, and template structures. Includes RRF hybrid search (pgvector cosine + FTS), parent-context expansion, and always-on summary prepend.
- **Query Rewriter** *(env-gated)*: Offline Vietnamese legal synonym expansion + optional LLM rewrite for vector-optimized queries. Wraps `ragService.search()` on both orchestrator and QA paths.
- **Context Filter** *(env-gated)*: Post-retrieval LLM-based relevancy filter + faithfulness/answerability judges. Drops noise chunks before generation.
- **Context Packer**: Packs retrieved chunks into a context window with character-limit awareness (`RAG_CONTEXT_MAX_CHARS`).
- **Retrieval Pipeline**: Composes query rewrite → RAG search → context filter → context packing into a single pipeline.
- **Self-Correct Loop** *(env-gated)*: Bounded retry — re-retrieves on poor relevance, signals regeneration on hallucination. Hard-capped at 1 retry.
- **Prompt Builder**: Assembles System (role, rules), Context (legal refs, docs), Examples, Request, and JSON Schema.
- **LLM Service**: Generates Stage 1 (Outline JSON) and Stage 2 (Content JSON).
- **LLM Config Service**: Per-user model provider configuration (LM Studio, OpenRouter, etc.) with encrypted storage.
- **OpenRouter Models**: Manages recommended OpenRouter model list from env config.
- **Output Validator**: Checks required fields, structure (Điều → Khoản → Điểm), legal references, and Vietnamese language. Auto-fixes or regenerates if needed.
- **Structured Output Service**: JSON schema enforcement for LLM output.
- **Template Service**: Decree 30/2020 docxtpl template management, upload, compilation, and mapping.
- **Template Compiler**: Compiles uploaded DOCX templates — extracts placeholders, validates structure.
- **Template Generation Service**: Generates DOCX from structured JSON using compiled templates.
- **Template Semantics**: Semantic matching of template placeholders to document fields.
- **Template Typography Rules**: Enforces Vietnamese government typography rules on generated content.
- **Template Vision Service**: Vision-based template analysis for placeholder extraction.
- **Template Service Client**: HTTP client for the document-renderer microservice.
- **Template Storage Service**: Manages template file storage on disk.
- **DOCX Service**: DOCX generation from structured JSON.
- **Document Profile Service**: Manages organization-specific document profiles (headers, signatures, org info).
- **Ingestion Service**: Document ingestion (PDF/DOCX → chunks + summary).
- **Ingestion Worker**: Background worker for async document ingestion jobs.
- **Ingestion Job Repository**: Database repository for ingestion job state tracking.
- **Feedback Service**: Captures user edits, computes diffs, and classifies edits (correction, addition, style, structure). Stores in PostgreSQL.
- **Feedback Analysis**: Edit classification & quality scoring.
- **Format Service**: Applies docxtpl templates to generate final DOCX files.

#### Infrastructure & Fine-Tuning
- **PostgreSQL + pgvector**: Stores documents, chunks, embeddings (HNSW index, cosine ops), templates, and feedback.
- **Redis**: Stores workflow state, session data, and generation progress.
- **LM Studio**: Serves local LLM (base model + LoRA adapters) via OpenAI-compatible API.
- **Fine-Tuning Pipeline**: When the Feedback Service accumulates >= 50 quality examples, it triggers **NeMo AutoModel** to perform LoRA fine-tuning. The new LoRA weights are then hot-swapped into LM Studio.

### 3. Data Flow — One Complete Request

1. **EXTRACT**: User uploads PDF/DOCX. Processed by Docling or MarkItDown. Outputs structured JSON.
2. **CHUNK**: Document split by Điều/Khoản/Điểm. Embedded using Jina Embeddings V5.
3. **STORE**: Chunks and embeddings saved to pgvector (remember step).
4. **PARSE**: User types a command (e.g., *viết quyết định chuyển đổi vị trí cho Ông Nguyễn Văn A*). CMD Parser extracts intent and entities.
5. **RETRIEVE**: Semantic search in pgvector fetches relevant legal references, similar documents, and org info.
6. **BUILD PROMPT**: Assemble system prompt, context, few-shot examples, parsed user request, and required JSON schema.
7. **GENERATE**: LLM generates an Outline (Stage 1), followed by the Content (Stage 2). Outputs structured JSON.
8. **VALIDATE**: Output is verified for structural and logical correctness. Regenerated if errors are found.
9. **FORMAT**: Fill selected docxtpl template with the generated JSON.
10. **RETURN**: Final .docx file is delivered to the user with proper VN gov formatting.

### 4. The Golden Rule

> **JSON is the universal format between every component.**
> 
> Extraction → JSON → RAG stores JSON → LLM outputs JSON → DOCX.
> The LLM **NEVER** sees Markdown and **NEVER** touches formatting. It only produces and consumes structured JSON.


### Service Ports
| Service | Port |
|---------|------|
| Frontend (Next.js) | 3000 |
| Backend (Express.js) | 3001 |
| LM Studio (OpenAI-compatible API) | 1234 |
| PostgreSQL + pgvector | 5432 |
| Redis | 6379 |
| Docling (FastAPI — PDF parsing) | 8001 |
| Embeddings Service (Jina V3) | 8002 |
| Document Renderer (C# .NET 10 + LibreOffice) | 8080 |
| LoRA / Training Service (NeMo) | 8003 |

---

## Technology Stack

### Backend (TypeScript 7)
- **Runtime**: Node.js 20+ with Express.js + TypeScript 7
- **AI**: LM Studio / OpenRouter (OpenAI-compatible API via orchestrator), Jina Embeddings V5
- **Database**: PostgreSQL 15+ with pgvector (via Prisma ORM)
- **Cache**: Redis (workflow state, session data, generation progress)
- **PDF Parsing**: Docling FastAPI microservice (:8001)
- **DOCX Rendering**: document-renderer (C# .NET 10 + LibreOffice headless, port 8080)
- **Validation**: Zod schemas + Output Validator (structure, legal refs, language)
- **Logging**: Pino (structured JSON logging) + pino-pretty (dev)
- **Resilience**: Circuit breaker, retry with backoff, request timeout middleware

### Frontend
- **Framework**: Next.js 16 (App Router) + TypeScript 7
- **State**: React Query (TanStack Query)
- **Editor**: Monaco Editor (Word-like document interface)
- **Styling**: Tailwind CSS + Radix Themes (Radix UI component library)
- **Testing**: Vitest + Testing Library
- **Pages**: Landing, Generate, Documents, QA, Dashboard, Templates, Login/Signup

### ML/LLM
- **Model**: Your downloaded model served via LM Studio (OpenAI-compatible API), or remote via OpenRouter
- **Fine-tuning**: NeMo AutoModel (LoRA — triggered at ≥ 50 feedback examples)
- **Embeddings**: Jina Embeddings V5 (multilingual)

---

## Development Workflows

### Common Tasks
```bash
# Check GPU status
nvidia-smi

# Test RAG search
curl http://localhost:3001/api/rag/search -d '{"query": "your query here"}'

# View container logs
docker-compose logs -f postgres docling redis

# Run tests
npm test           # Backend (jest)
cd frontend && npm test  # Frontend (vitest)
```

### Database Operations
```bash
# Prisma commands
npx prisma migrate dev
npx prisma generate
npx prisma studio # Open GUI

# Fresh database deploy
npm run prisma:deploy:fresh

# Verify ownership integrity
npm run verify:ownership

# HNSW index (after initial setup)
psql -U postgres -d ai_docs -c "CREATE INDEX CONCURRENTLY idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops);"
```

### Troubleshooting
```bash
# Streaming not working - check LM Studio server is running
curl http://localhost:1234/v1/models

# Docling tables missing
# Ensure: pipeline_options.do_table_structure = True
```

---

## Key Files & Structure

```
├── backend/
│   ├── prisma/schema.prisma          # Database schema (PostgreSQL + pgvector)
│   ├── scripts/                      # Root-level deployment & integrity scripts
│   │   ├── assert_owner_integrity.ts     # Verify document ownership invariants
│   │   ├── check_migration_integrity.test.ts
│   │   ├── check_prisma_adoption.ts
│   │   ├── check_schema_sync.js
│   │   ├── deploy_fresh_database.ts      # Fresh database setup
│   │   ├── deploy_fresh_database.test.ts
│   │   └── repository_release_integrity.test.ts
│   ├── src/
│   │   ├── index.ts                  # Express server entry point
│   │   ├── config/
│   │   │   └── openrouter_models.ts  # OpenRouter recommended model list
│   │   ├── services/
│   │   │   ├── orchestrator.ts        # 8-step workflow (parse → generate → validate)
│   │   │   ├── rag_service.ts         # Vector search with pgvector + Jina V3, text cleaning, summary chunk gen
│   │   │   ├── query_rewriter.ts      # [RAG-A] Offline synonym expansion + LLM query rewrite (env-gated)
│   │   │   ├── context_filter.ts      # [RAG-C] Post-retrieval relevancy filter + faithfulness/answerability judges
│   │   │   ├── context_packer.ts      # Context window packing with char-limit awareness
│   │   │   ├── retrieval_pipeline.ts  # Composed retrieval pipeline (rewrite → search → filter → pack)
│   │   │   ├── retrieval_observability.ts  # Retrieval telemetry & diagnostics
│   │   │   ├── self_correct.ts        # [RAG-E] Bounded retrieval retry + generation hallucination guard
│   │   │   ├── template_service.ts    # Decree 30/2020 docxtpl template management
│   │   │   ├── template_compiler.ts   # DOCX template compilation & placeholder extraction
│   │   │   ├── template_generation_service.ts  # Generate DOCX from structured JSON via templates
│   │   │   ├── template_semantics.ts  # Semantic matching of template placeholders
│   │   │   ├── template_typography_rules.ts  # Vietnamese gov typography enforcement
│   │   │   ├── template_vision_service.ts    # Vision-based template analysis
│   │   │   ├── template_service_client.ts    # HTTP client for document-renderer
│   │   │   ├── template_storage_service.ts   # Template file storage management
│   │   │   ├── docx_service.ts        # DOCX generation from structured JSON
│   │   │   ├── structured_output_service.ts  # JSON schema enforcement for LLM output
│   │   │   ├── document_profile_service.ts   # Organization document profile management
│   │   │   ├── ingestion_service.ts   # Document ingestion (PDF/DOCX → chunks + summary)
│   │   │   ├── ingestion_worker.ts    # Background async ingestion worker
│   │   │   ├── ingestion_job_repository.ts   # Ingestion job state DB repository
│   │   │   ├── feedback_service.ts    # User edit capture & diff computation
│   │   │   ├── feedback_analysis.ts   # Edit classification & quality scoring
│   │   │   ├── llm_config_service.ts  # Per-user LLM model configuration (encrypted)
│   │   │   ├── openrouter_models.ts   # OpenRouter model list management
│   │   │   └── cmd_parser.ts          # Command/intent parser
│   │   ├── routes/
│   │   │   ├── workflow.ts            # Document generation endpoints
│   │   │   ├── rag.ts                 # RAG search, indexing & ingestion endpoints
│   │   │   ├── documents.ts           # Document CRUD operations
│   │   │   ├── feedback.ts            # Feedback submission and stats
│   │   │   ├── llm-settings.ts        # LLM model settings API
│   │   │   ├── qa.ts                  # Q&A route — SSE streaming with citation-based answers
│   │   │   ├── auth.ts                # Authentication routes
│   │   │   ├── templates.ts           # Template CRUD, upload, compilation, rendering
│   │   │   └── document-profile.ts    # Organization document profile endpoints
│   │   ├── scripts/
│   │   │   ├── evaluate_rag.ts        # RAG eval — Recall@K, MRR + RAGAS faithfulness/relevancy
│   │   │   ├── reindex_corpus.ts      # Re-index all docs (optionally regenerate summaries)
│   │   │   ├── backfill_embeddings.ts # Backfill missing chunk embeddings
│   │   │   ├── parse_and_store.ts     # Parse PDF and store chunks (no embeddings)
│   │   │   └── split_and_index.ts     # Split text file and index chunks
│   │   ├── middleware/
│   │   │   ├── validation.ts          # Zod input validation
│   │   │   ├── timeout.ts             # Request timeout (10s default, 60s generation)
│   │   │   ├── user_auth.ts           # JWT auth (token verification + user-level authorization)
│   │   │   ├── ratelimit.ts           # Rate limiting
│   │   │   ├── sanitize.ts            # Input sanitization
│   │   │   ├── requestId.ts           # Request ID injection for tracing
│   │   │   └── errorHandler.ts        # Global error handler
│   │   ├── utils/
│   │   │   ├── prisma.ts              # Prisma client singleton
│   │   │   ├── redis.ts               # Redis client (state, cache, progress)
│   │   │   ├── embeddings_client.ts   # Jina Embeddings V5 client
│   │   │   ├── circuit_breaker.ts     # Circuit breaker for external services
│   │   │   ├── retry.ts               # Retry with exponential backoff
│   │   │   ├── sse_parser.ts          # Server-Sent Events parser (streaming)
│   │   │   ├── encryption.ts          # Data encryption utilities
│   │   │   ├── sanitize.ts            # Output sanitization
│   │   │   ├── feedback_utils.ts      # Feedback diff & classification helpers
│   │   │   ├── abort.ts               # AbortController utilities for request cancellation
│   │   │   ├── document_access.ts     # Document ownership/access checking
│   │   │   ├── errors.ts              # Custom error types
│   │   │   ├── urlGuard.ts            # URL validation & private-IP guard for user LLM configs
│   │   │   └── validateEnv.ts         # Environment variable validation
│   │   ├── types/
│   │   │   └── templates.ts           # Template-related type definitions
│   │   └── constants/
│   │       └── document-types.ts      # Vietnamese document type definitions
├── frontend/
│   ├── app/
│   │   ├── layout.tsx                 # Root layout
│   │   ├── page.tsx                   # Landing page
│   │   ├── globals.css                # Global styles
│   │   ├── (app)/                     # Authenticated app route group
│   │   │   ├── layout.tsx             # App shell layout
│   │   │   ├── generate/page.tsx      # Document generation UI
│   │   │   ├── documents/             # Document management pages
│   │   │   ├── qa/                    # Q&A / knowledge search pages
│   │   │   ├── dashboard/page.tsx     # Dashboard overview
│   │   │   └── templates/page.tsx     # Template management page
│   │   ├── (auth)/                    # Authentication route group
│   │   │   ├── layout.tsx             # Auth layout
│   │   │   ├── login/                 # Login page
│   │   │   └── signup/                # Signup page
│   │   └── api/                       # Next.js API proxy routes
│   │       ├── proxy/                 # Backend API proxy
│   │       ├── session/               # Session management
│   │       └── analytics/             # Analytics endpoints
│   ├── components/
│   │   ├── StreamingDocumentEditor.tsx # Monaco editor with streaming
│   │   ├── DocumentEditor.tsx         # Standard document editor
│   │   ├── DocumentDiffViewer.tsx     # Diff comparison UI
│   │   ├── DocumentCard.tsx           # Document list card
│   │   ├── DocumentDetailModal.tsx    # Document detail modal
│   │   ├── TemplatePreviewModal.tsx   # Template preview modal
│   │   ├── analytics/                 # Analytics dashboard components
│   │   │   └── PageTracker.tsx
│   │   ├── auth/                      # Authentication components
│   │   │   ├── AuthForm.tsx
│   │   │   ├── AuthProvider.tsx
│   │   │   ├── PasswordField.tsx
│   │   │   └── RequireSession.tsx
│   │   ├── settings/                  # User settings components
│   │   │   ├── LLMSettingsDialog.tsx
│   │   │   ├── LLMSettingsForm.tsx
│   │   │   ├── LLMProviderForm.tsx
│   │   │   ├── OpenRouterModelPicker.tsx
│   │   │   ├── DocumentDefaultsDialog.tsx
│   │   │   ├── DocumentDefaultsForm.tsx
│   │   │   └── DocumentProfileForm.tsx
│   │   ├── templates/                 # Template management components
│   │   │   ├── ReadyTemplateSelect.tsx
│   │   │   ├── TemplateMappingReview.tsx
│   │   │   ├── TemplateStatusCard.tsx
│   │   │   └── TemplateUploadDialog.tsx
│   │   ├── feature/                   # Feature-specific components
│   │   │   ├── FeedbackPanel.tsx
│   │   │   ├── FidelityWarningPanel.tsx
│   │   │   ├── SourcePanel.tsx
│   │   │   ├── TemplateGallery.tsx
│   │   │   ├── TemplatePreviewModal.tsx
│   │   │   └── ValidationPanel.tsx
│   │   ├── providers/                 # React context providers
│   │   │   ├── QueryProvider.tsx
│   │   │   └── ThemeProvider.tsx
│   │   ├── layout/                    # Layout components (nav, sidebar)
│   │   ├── lib/                       # Component-level utilities
│   │   └── ui/                        # Shared UI primitives
│   ├── lib/
│   │   ├── api.ts                     # Backend API client
│   │   ├── settings-api.ts            # User settings API client
│   │   ├── templates-api.ts           # Template management API client
│   │   ├── analytics.ts               # Analytics utilities
│   │   ├── auth.ts                    # Auth helpers
│   │   ├── sse.ts                     # SSE streaming client
│   │   ├── theme.ts                   # Theme configuration
│   │   ├── constants/                 # Frontend constants
│   │   └── server/                    # Server-side utilities
│   └── types/
│       └── api.ts                     # API response type definitions
├── docling-service/
│   ├── main.py                        # FastAPI PDF parser (PyMuPDF fallback)
│   ├── requirements.txt
│   ├── requirements-dev.txt
│   ├── tests/
│   └── Dockerfile
├── embeddings-service/
│   ├── main.py                        # Jina Embeddings V5 service
│   ├── requirements.txt
│   ├── requirements-dev.txt
│   ├── tests/
│   └── Dockerfile
├── document-renderer/                 # C# .NET 10 ASP.NET Web API
│   ├── src/
│   │   ├── DocumentRenderer.Api/      # Web API entry point (Program.cs)
│   │   └── DocumentRenderer.Core/     # Core rendering logic
│   ├── tests/                         # Renderer tests
│   ├── fixtures/                      # Test fixture templates
│   ├── fixture-builder/               # Fixture generation tools
│   ├── DocumentRenderer.sln           # .NET solution file
│   ├── Dockerfile
│   └── README.md
├── deploy/                            # Production deployment configs
│   ├── docker-compose.prod.yml        # Production compose file
│   ├── nginx/                         # Nginx reverse proxy configs
│   ├── generate-secrets.sh            # Secret generation script
│   ├── migrate-postgres.sh            # Database migration script
│   ├── .env.prod.example              # Production env template
│   └── README.md
├── ops/                               # Operations & testing scripts
│   ├── verify-all.ps1                 # Full verification suite
│   ├── verify-postgres.ps1            # PostgreSQL verification
│   ├── backup-postgres.ps1            # PostgreSQL backup
│   ├── import-postgres-data.ps1       # Data import
│   ├── rehearse-cutover.ps1           # Cutover rehearsal
│   ├── test-compose.ps1               # Docker compose tests
│   ├── test-prod-compose.ps1          # Production compose tests
│   ├── test-migrations.ps1            # Migration tests
│   ├── test-renderer-container.ps1    # Renderer container tests
│   ├── fixtures/                      # Test fixtures
│   ├── lib/                           # Shared PowerShell utilities
│   └── tests/                         # Ops test scripts
├── lora-outputs/                      # LoRA training output artifacts (empty until training)
├── templates/                         # DOCX document templates (Decree 30/2020)
│   ├── quyet-dinh.docx                # Quyết định template
│   ├── cong-van.docx                  # Công văn template
│   ├── thong-bao.docx                 # Thông báo template
│   ├── bao-cao.docx                   # Báo cáo template
│   ├── chi-thi.docx                   # Chỉ thị template
│   └── thong-tu.docx                  # Thông tư template
├── add_header.py                      # Header processing utility
├── docker-compose.yml                 # All services orchestration
├── init.sql                           # PostgreSQL init script
└── init-hnsw.sql                      # HNSW index creation script
```

---

## Core Concepts

### 1. Hierarchical RAG
Documents are chunked at 4 levels:
- **Summary (Level 0)**: LLM-generated document summary chunk (`isSummary=true`). One per document. Always prepended to search results for global grounding.
- **Article (Điều, Level 1)**: Full article context
- **Clause (Khoản, Level 2)**: Individual clause (prepended with parent article context)
- **Point (Điểm, Level 3)**: Sub-point details (prepended with parent article + clause context)

Hybrid search via RRF (Reciprocal Rank Fusion) combines pgvector cosine similarity with PostgreSQL full-text search. Parent context expansion enriches Level 2/3 chunks.

### 2. RAG Quality Loop (env-gated, default OFF)
All features are additive and env-gated so production is never broken:

```
  User query
      │
      ▼
  [A] Query Rewriter (ENABLE_QUERY_REWRITER)
      │  Offline synonym expansion + optional LLM rewrite
      ▼
  [B/H] RAG Search + Always-on Summary Prepend (ENABLE_SUMMARY_CHUNKS)
      │  RRF hybrid search → prepend level-0 summary of top doc
      ▼
  [C] Relevancy Filter (ENABLE_RERANK_FILTER)
      │  LLM judges chunk relevance; drops noise (keeps all if ≤3)
      ▼
  [E] Self-Correct (ENABLE_SELF_CORRECT)
      │  If <2 relevant chunks → rewrite + re-retrieve (max 1 retry)
      │  After generation → faithfulness check → signal low_confidence
      ▼
  Generation (orchestrator WriterAgent / qa.ts streaming)
```

### 3. Orchestrator Workflow
Eight-step pipeline managed by `orchestrator.ts`:
1. **Parse**: CMD Parser extracts intent + entities from user command
2. **Extract**: Docling (PDF) or MarkItDown (DOCX) → structured JSON
3. **Retrieve**: Query rewrite → semantic search via pgvector → relevancy filter → legal refs, similar docs, org info
4. **Build Prompt**: System + context + few-shot examples + command + JSON schema
5. **Stage 1 — Outline**: LLM generates document outline (Điều titles)
6. **Stage 2 — Content**: LLM fills body (Khoản + Điểm)
7. **Validate**: Output Validator checks structure, legal refs, Vietnamese language; auto-fixes or regenerates
8. **Format**: docxtpl template → final .docx with Decree 30/2020 formatting

### 4. Self-Learning Loop
```
User edits document → Diff computed (feedback_service.ts) → Edit classified (feedback_analysis.ts)
↓
Store feedback in PostgreSQL → Accumulate quality examples (≥ 50)
↓
Trigger NeMo AutoModel LoRA training → Hot-swap weights into LM Studio
```

### 5. Decree 30/2020 Compliance
Required document elements:
- Header: "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM"
- Document number: "Số: ..."
- Date/place: "Hà Nội, ngày X tháng Y năm Z"
- Signature block with name, title, stamp

---

## Environment Variables

### Backend (.env)
```
# ─── Core infrastructure ──────────────────────────────
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_docs
REDIS_URL=redis://localhost:6379
DOCLING_URL=http://localhost:8001
EMBEDDINGS_URL=http://localhost:8002
EMBEDDINGS_BATCH_TIMEOUT_MS=300000 # Increase for CPU-only local embedding models
DOCUMENT_RENDERER_URL=http://localhost:8080
RENDERER_INTERNAL_TOKEN=<strong-internal-renderer-token>
TEMPLATE_STORAGE_DIR=../../uploads/templates
JWT_SECRET=<your-jwt-secret-min-32-chars>
CORS_ORIGIN=http://localhost:3000
TRUST_PROXY_HOPS=0
NODE_ENV=development
LLM_CONFIG_ENCRYPTION_KEY=<64-char-hex-for-AES-256-GCM-user-settings>
ALLOW_STACK_TRACES=false              # Include stack traces in error responses
DISABLE_PUBLIC_REGISTER=false         # Set "true" to disable POST /api/auth/register

# ─── LLM provider security ────────────────────────────
LOCAL_LLM_HOST_ALLOWLIST=host.docker.internal:1234  # Private-IP host:port pairs allowed for user LLM configs

# Optional defaults for maintenance scripts without a user context only
# DEFAULT_LLM_PROVIDER=openrouter
# DEFAULT_LLM_BASE_URL=https://openrouter.ai/api/v1
# DEFAULT_LLM_MODEL=openrouter/free
# DEFAULT_LLM_API_KEY=<maintenance-key>

# ─── OpenRouter ────────────────────────────────────────
OPENROUTER_RECOMMENDED_MODELS=openrouter/free  # Comma-separated model IDs for recommendations

# ─── RAG quality loop (all default OFF) ───────────────
ENABLE_QUERY_REWRITER=false       # [A] Offline synonym + LLM query rewrite
ENABLE_SUMMARY_CHUNKS=false       # [B/H] Generate level-0 summary chunks at ingest + always-on prepend
ENABLE_RERANK_FILTER=false        # [C] Post-retrieval LLM relevancy filter
ENABLE_SELF_CORRECT=false         # [E] Bounded self-correcting retrieval/generation loop
RAG_MAX_RETRIES=1                 # [E] Max retry count for self-correct (hard cap)
RAG_FAITHFULNESS_MIN=0.5          # [E] Min faithfulness score before regeneration signal
RAG_ANSWERABILITY_MIN=0.3         # [E] Min answerability score before regeneration signal
RAG_RETRIEVAL_CANDIDATES=24       # Number of candidate chunks to retrieve before filtering
RAG_MAX_QUERY_VARIANTS=3          # Max query variants for multi-query retrieval
RAG_CONTEXT_MAX_CHARS=9000        # Max characters for packed context window
RAG_QUERY_EMBED_CACHE_TTL_SECONDS=300  # Query embedding cache TTL
RAG_OBSERVABILITY=false           # Enable retrieval telemetry logging
RAG_RERANK_CHUNK_CHARS=1200       # Max chars per chunk for reranking
RAG_RERANK_MAX_CHARS=16000        # Max total chars for reranking input
EVAL_GENERATE=false               # [D] Enable LLM generation in RAG eval (adds faithfulness/relevancy)
EVAL_RESULTS_PATH=                # Custom path for eval results output
RAG_RRF_K=60                      # RRF smoothing constant
RAG_OVERFETCH_MULTIPLIER=4        # Over-fetch multiplier for RRF candidate pool
```

### Frontend (.env.local)
```
BACKEND_API_URL=http://localhost:3001
```
Server-side only — never exposed to client bundle. The API proxy at `app/api/proxy/[...path]/route.ts` forwards requests to this backend.

---

## Performance Targets

| Metric | Target |
|--------|--------|
| PDF Parse Time | < 30s (10 pages) |
| Generation Time | 60-90s (full doc) |
| RAG Query Latency | < 200ms (base), +0.3–1s with query rewriter LLM path |
| Format Accuracy | > 85% |
| RAG Recall@5 | Measured via `evaluate_rag.ts` — track baseline vs improvements |
| RAG MRR | Measured via `evaluate_rag.ts` — track baseline vs improvements |
| Faithfulness | Measured with `EVAL_GENERATE=true` — target ≥ 0.7 |
| Answer Relevancy | Measured with `EVAL_GENERATE=true` — target ≥ 0.7 |

---

## Testing

```bash
# Backend tests (Jest)
cd backend && npm test

# Frontend tests (Vitest)
cd frontend && npm test

# RAG evaluation (retrieval quality)
cd backend
npx tsx src/scripts/evaluate_rag.ts              # Recall@K + MRR (keyword, fast)
EVAL_GENERATE=true npx tsx src/scripts/evaluate_rag.ts  # + Faithfulness + Answer Relevancy (LLM, slow)

# Re-index one corpus partition (repeat per document type)
npx tsx src/scripts/reindex_corpus.ts --force --dir ..\docs\files --doctype cong-van

# Migration integrity tests
npm run test:migrations

# Schema sync check
npm run check-schema

# Ops verification (PowerShell)
cd ops
./verify-all.ps1
./verify-postgres.ps1
./test-renderer-container.ps1
```

---

## Production Checklist

- [ ] Seed RAG with 100+ relevant PDFs
- [ ] Validate Decree 30/2020 compliance on 50 test docs
- [ ] Setup backups (PostgreSQL daily, S3 for uploads)
- [ ] Configure monitoring (GPU/RAM metrics, logs, Redis connectivity)
- [ ] SSL/TLS certificates + Nginx reverse proxy (see `deploy/nginx/`)
- [ ] Unit test coverage > 70%
- [ ] Enable pgvector HNSW index for vector search performance
- [ ] Configure Redis TTL for session/state cleanup
- [ ] Verify every service liveness/readiness probe before cutover
- [ ] Set `NODE_ENV=production`
- [ ] Run `ops/rehearse-cutover.ps1` to validate production readiness

---

## Security Considerations

- All file uploads validate PDF magic bytes (multer with MIME type filtering)
- SQL injection prevention via Prisma ORM
- Input sanitization (HTML escaping, length limits via Zod validation)
- User-configured model providers are encrypted at rest and restricted by the backend allowlist (`LOCAL_LLM_HOST_ALLOWLIST`)
- URL guard (`urlGuard.ts`) prevents SSRF by blocking private/RFC1918 IPs in user LLM config URLs
- Database-revalidated JWT user sessions; documents, templates, feedback, and model settings are owner-scoped
- Environment variables for sensitive data (`POSTGRES_PASSWORD`, `JWT_SECRET`, renderer token)
- Request timeout middleware prevents hanging connections (10s default, 60s for generation)
- Document renderer runs in an isolated Docker network (`renderer_internal`), not exposed to host
- Renderer container runs with `no-new-privileges`, all capabilities dropped

---

## Gotchas

- **Missing user LLM config**: generation is rejected until the user saves and tests a provider under Settings.
- **Local provider API format**: LM Studio and custom providers must expose an OpenAI-compatible `/v1/chat/completions` endpoint.
- **Document renderer is C#/.NET 10**, not Python. It uses LibreOffice headless + Poppler for DOCX→PDF conversion and rendering.
- **Renderer port is 8080** (not 8005). It runs inside an internal Docker network and is not exposed to the host.
- **Frontend tests use Vitest**, not Jest. Use `npm test` in the frontend directory.
- **Backend `predev` script** runs `prisma migrate deploy` automatically before `npm run dev`.

---

## Related Documentation (Original Files)

All original markdown files are stored in the `ori/` folder:

### Phase Guides
- [Phase 1: Infrastructure](ori/phases/phase-1-infrastructure.md) - GPU setup, LM Studio, backend/frontend initialization
- [Phase 2: PDF Parsing](ori/phases/phase-2-docling.md) - Docling microservice for PDF extraction
- [Phase 3: RAG System](ori/phases/phase-3-rag.md) - Hierarchical chunking, pgvector, embeddings
- [Phase 4: LM Studio](ori/phases/phase-4-ollama.md) - LM Studio config, streaming, prompts
- [Phase 5: Workflow](ori/phases/phase-5-workflow.md) - Agent orchestration, state persistence
- [Phase 6: Frontend](ori/phases/phase-6-frontend.md) - Next.js, Monaco editor, streaming UI
- [Phase 7: Feedback](ori/phases/phase-7-feedback.md) - Self-learning, feedback capture
- [Phase 8: LoRA](ori/phases/phase-8-lora.md) - Fine-tuning with NeMo AutoModel

### Reference Documents
- [Technical Specifications](ori/reference/TECHNICAL_SPECIFICATIONS.md) - Complete config reference
- [Best Practices](ori/reference/best-practices.md) - Security, performance, testing strategies
- [Security Baseline](ori/reference/SECURITY_BASELINE.md) - Security requirements and standards
- [Backend Contract](ori/reference/CURRENT_BACKEND_CONTRACT.md) - API contract documentation
- [README](ori/README.md) - Original project overview

# context-mode — MANDATORY routing rules

context-mode MCP tools available. Rules protect context window from flooding. One unrouted command dumps 56 KB into context.

## Think in Code — MANDATORY

Analyze/count/filter/compare/search/parse/transform data: **write code** via `ctx_execute(language, code)`, `console.log()` only the answer. Do NOT read raw data into context. PROGRAM the analysis, not COMPUTE it. Pure JavaScript — Node.js built-ins only (`fs`, `path`, `child_process`). `try/catch`, handle `null`/`undefined`. One script replaces ten tool calls.

## BLOCKED — do NOT attempt

### curl / wget — BLOCKED
Intercepted and replaced with error. Do NOT retry.
Use: `ctx_fetch_and_index(url, source)` or `ctx_execute(language: "javascript", code: "const r = await fetch(...)")`

### Inline HTTP — BLOCKED
`fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, `http.request(` — intercepted. Do NOT retry.
Use: `ctx_execute(language, code)` — only stdout enters context

### WebFetch — BLOCKED
Use: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)`

## REDIRECTED — use sandbox

### Bash (>20 lines output)
Bash ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`.
Otherwise: `ctx_batch_execute(commands, queries)` or `ctx_execute(language: "shell", code: "...")`

### Read (for analysis)
Reading to **Edit** → Read correct. Reading to **analyze/explore/summarize** → `ctx_execute_file(path, language, code)`.

### Grep — may flood context
Use `ctx_execute(language: "shell", code: "grep ...")` in sandbox.

## Tool selection

0. **MEMORY**: `ctx_search(sort: "timeline")` — after resume, check prior context before asking user.
1. **GATHER**: `ctx_batch_execute(commands, queries)` — runs all commands, auto-indexes, returns search. ONE call replaces 30+. Each command: `{label: "header", command: "..."}`.
2. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` — all questions as array, ONE call (default relevance mode).
3. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` — sandbox, only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` — raw HTML never enters context.
5. **INDEX**: `ctx_index(content, source)` — store in FTS5 for later search.

## Parallel I/O batches

For multi-URL fetches or multi-API calls, **always** include `concurrency: N` (1-8):

- `ctx_batch_execute(commands: [3+ network commands], concurrency: 5)` — gh, curl, dig, docker inspect, multi-region cloud queries
- `ctx_fetch_and_index(requests: [{url, source}, ...], concurrency: 5)` — multi-URL batch fetch

**Use concurrency 4-8** for I/O-bound work (network calls, API queries). **Keep concurrency 1** for CPU-bound (npm test, build, lint) or commands sharing state (ports, lock files, same-repo writes).

## Subagent routing

Routing block auto-injected into subagent prompts. Bash-type subagents upgraded to general-purpose. No manual instruction needed.

## Output

Write artifacts to FILES — never inline. Return: file path + 1-line description.
Descriptive source labels for `ctx_search(source: "label")`.

## Session Continuity

Skills, roles, and decisions persist for the entire session. Do not abandon them as the conversation grows.

## Memory

Session history is persistent and searchable. On resume, search BEFORE asking the user:

| Need | Command |
|------|---------|
| What were we working on? | `ctx_search(queries: ["summary"], source: "compaction", sort: "timeline")` |
| What was the first request? | `ctx_search(queries: ["prompt"], source: "user-prompt", sort: "timeline")` |
| What did we decide? | `ctx_search(queries: ["decision"], source: "decision", sort: "timeline")` |
| What NOT to repeat? | `ctx_search(queries: ["rejected"], source: "rejected-approach")` |
| What constraints exist? | `ctx_search(queries: ["constraint"], source: "constraint")` |

DO NOT ask "what were we working on?" — SEARCH FIRST.
If search returns 0 results, proceed as a fresh session.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call `ctx_stats` MCP tool, display full output verbatim |
| `ctx doctor` | Call `ctx_doctor` MCP tool, run returned shell command, display as checklist |
| `ctx upgrade` | Call `ctx_upgrade` MCP tool, run returned shell command, display as checklist |
| `ctx purge` | Call `ctx_purge` MCP tool with confirm: true. Warns before wiping knowledge base. |

After /clear or /compact: knowledge base and session stats preserved. Use `ctx purge` to start fresh.
