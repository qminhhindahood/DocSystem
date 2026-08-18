# AI Document System for Vietnamese Government

A production-ready AI system for generating administrative documents compliant with Decree 30/2020/NĐ-CP, using a local LLM (via LM Studio) and a full-stack architecture.

## Google Cloud personal pilot

The single-operator Google Cloud release is defined by the [SMTP-free pilot design](docs/superpowers/specs/2026-08-11-gcp-smtp-free-personal-pilot-design.md). Follow the [owner action guide](docs/operations/gcp-owner-action-guide.md) for the remaining secret and release gates.

Email recovery is intentionally unavailable in this phase. Account recovery uses the private, owner-only reset helper documented in the guide; production remains disabled until CI, a reviewed Terraform plan, migration, and smoke gates pass.

## Quick Start

### Prerequisites

- **GPU**: VRAM sufficient for your chosen model (check LM Studio requirements)
- **OS**: Windows 11 / Ubuntu 22.04
- **Tools**: Docker, Node.js 20+, Python 3.11+, LM Studio
- **DOCX rendering**: Docker builds the open-source LibreOffice, Poppler, and free-font renderer automatically

### Setup Commands

```bash
# 1. Start LM Studio and load your model
# - Open LM Studio
# - Load your downloaded model
# - Start the local server (default: http://localhost:1234)
# - Note the server URL and model name for the .env file

# 2. Start infrastructure (PostgreSQL + pgvector + Redis + Docling)
docker compose up -d postgres redis docling embeddings document-renderer

# 3. Initialize backend
cd backend
npm install
npx prisma migrate dev
npm run dev
# Port 3001

# 4. Start frontend
cd frontend
npm install
npm run dev
# Port 3000

# 5. Install Python service development/test dependencies
python -m pip install -r docling-service/requirements-dev.txt
python -m pip install -r embeddings-service/requirements-dev.txt
```

## Architecture

```
┌─────────────────┐ ┌──────────────────┐ ┌─────────────────┐
│ Frontend        │─│ Express.js       │─│ LM Studio       │
│ Next.js         │ │ Backend API      │ │ (Local LLM)     │
│                 │ │                  │ │                 │
│ - Upload PDF    │ │ - Orchestrator   │ └─────────────────┘
│ - Generate UI   │ │ - RAG Service    │
│ - Monaco Edit   │ │ - Prompt Mgmt    │ ┌─────────────────┐
└─────────────────┘ └──────────────────┘ │ PostgreSQL      │
                                         │ + pgvector      │
                                         │ - Documents     │
                                         │ - Chunks        │
                                         │ - Templates     │
                                         │ - Feedback      │
                                         └─────────────────┘
                                          │           │
                                    ┌─────▼───┐ ┌─────▼──────┐
                                    │ Docling │ │ Redis      │
                                    │ Micro   │ │ Cache      │
                                    │ service │ │ (State     │
                                    │         │ │  Store)    │
                                    └─────────┘ └────────────┘
```

## Service Ports

| Service | Port |
|---------|------|
| Frontend (Next.js) | 3000 |
| Backend (Express.js) | 3001 |
| Docling (FastAPI) | 8001 |
| Embeddings (Jina V3) | 8002 |
| Doc Renderer (.NET, private Compose network only) | 8080 |
| LM Studio | 1234 |
| PostgreSQL | 5432 |
| Redis | 6379 |

## Technology Stack

### Backend (TypeScript 7)

- **Runtime**: Node.js 20+ with Express.js + TypeScript 7
- **AI**: LM Studio (OpenAI-compatible API), Jina Embeddings V5
- **Database**: PostgreSQL 15+ with pgvector (Prisma ORM and durable leased ingestion jobs)
- **Cache**: Redis (cache and rate-limit coordination)
- **PDF Parsing**: Docling FastAPI microservice
- **Validation**: Zod schemas
- **Security**: Helmet, CORS, rate limiting, JWT auth

### Frontend

- **Framework**: Next.js 16 (App Router) + TypeScript 7
- **State**: React Query (TanStack Query)
- **Editor**: Monaco Editor (Word-like interface)
- **Styling**: Tailwind CSS

### ML/LLM

- **Model**: Local model via LM Studio (OpenAI-compatible API)
- **Embeddings**: Jina Embeddings V5 (`jinaai/jina-embeddings-v5-text-small`, 1024-dim)

## Development Workflows

### Common Tasks

```bash
# Check GPU status
nvidia-smi

# Test RAG search
curl http://localhost:3001/api/rag/search -d '{"query": "your query here"}'

# View container logs
docker compose logs -f postgres docling redis

# Run tests
npm test          # Backend
npm run test      # Frontend

# Python microservice tests (after installing requirements-dev.txt above)
python -m pytest docling-service/tests -q
python -m pytest embeddings-service/tests -q
```

### Database Operations

```bash
# Prisma commands
npx prisma migrate dev
npx prisma generate
npx prisma studio  # Open GUI

# Existing databases without Prisma migration history must be backed up and
# checked with `npx tsx scripts/check_prisma_adoption.ts` before migration.
```

### Troubleshooting

```bash
# Streaming not working - test the provider connection in user Settings

# Docling tables missing
# Ensure: pipeline_options.do_table_structure = True

# pgvector extension not available
docker compose exec postgres psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

## Environment Variables

### Backend (.env)

```env
# Database
DATABASE_URL="postgresql://postgres:***@localhost:5432/ai_docs"

# LLM providers are configured per user in Settings. Optional provider-neutral
# defaults are only for maintenance scripts without a user context:
# DEFAULT_LLM_PROVIDER="openrouter"
# DEFAULT_LLM_BASE_URL="https://openrouter.ai/api/v1"
# DEFAULT_LLM_MODEL="openrouter/free"
# DEFAULT_LLM_API_KEY="your-maintenance-key"

# Google Gemini alternative (OpenAI-compatible API):
# DEFAULT_LLM_PROVIDER="gemini"
# DEFAULT_LLM_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai"
# DEFAULT_LLM_MODEL="gemini-3.6-flash"
# DEFAULT_LLM_API_KEY="your-gemini-key"

# Redis
REDIS_URL="redis://localhost:6379"

# Python microservices
DOCLING_URL="http://localhost:8001"
EMBEDDINGS_URL="http://localhost:8002"
DOCUMENT_RENDERER_URL="http://localhost:8080"
RENDERER_INTERNAL_TOKEN="replace-with-a-random-32-character-secret"
TEMPLATE_STORAGE_DIR="../../uploads/templates"

# CORS
CORS_ORIGIN="http://localhost:3000"

# JWT secret (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
JWT_SECRET="change-me-to-a-strong-jwt-secret-at-least-32-chars"

# LLM config encryption (for per-user LLM settings)
LLM_CONFIG_ENCRYPTION_KEY="generate-with: openssl rand -hex 32"

# Server
PORT=3001
NODE_ENV="development"
```

### Frontend (.env.local)

```env
BACKEND_API_URL="http://localhost:3001"
```

**Note**: `BACKEND_API_URL` is server-side only — never exposed to client bundle. The API proxy at `app/api/proxy/[...path]/route.ts` forwards requests to this backend.

## User workflow

Create an account at `/signup`, sign in at `/login`, and store your own model/API configuration and document defaults under `/settings`. Documents, references, feedback, and DOCX templates are private to that user. Upload a DOCX under `/templates`; it progresses through `UPLOADED`, `ANALYZING`, and `NEEDS_REVIEW`, and becomes `READY` only after mapping and fidelity prerequisites pass. Structurally verified generated files remain downloadable when visual validation reports a best-effort warning.

`/live` means a service process is running. `/ready` means its required model, open-source renderer executables/free fonts, storage, or other dependencies are actually available.

## LLM Providers

Each authenticated user selects a provider, model, and API key under Settings.
OpenRouter is the default choice. OpenRouter, OpenAI, and Google Gemini use
application-managed official base URLs; Gemini connects through Google's
OpenAI-compatible endpoint. API keys are encrypted before storage and never
returned to the browser. Local LM Studio or Ollama endpoints remain available for users whose
host and port are listed in `LOCAL_LLM_HOST_ALLOWLIST`; a containerized backend
uses `host.docker.internal` rather than `localhost` to reach host services.
### Local PostgreSQL (Docker)

If you prefer not to use a managed database, run Postgres locally:

```bash
# Start only Postgres + pgvector extension
docker compose up -d postgres

# Check it's ready
docker compose exec postgres pg_isready -U postgres -d ai_docs

# Enable pgvector extension (idempotent)
docker compose exec postgres psql -U postgres -d ai_docs -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Create HNSW index for vector search (after your first ingestion)
docker compose exec postgres psql -U postgres -d ai_docs -c "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chunks_embedding_hnsw ON \"Chunk\" USING hnsw (embedding vector_cosine_ops);"
```

Set `DATABASE_URL` in `backend/.env`:
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_docs?schema=public"
```

#### Backups

```bash
# Quick backup of the local Postgres volume
docker compose exec postgres pg_dump -U postgres ai_docs > backup_$(date +%Y%m%d).sql

# Restore
cat backup_20240101.sql | docker compose exec -T postgres psql -U postgres ai_docs
```

For production, schedule daily dumps and back them up to durable storage.

## Production Checklist

- [ ] Seed RAG with 100+ relevant PDFs
- [ ] Validate Decree 30/2020 compliance on 50 test docs
- [ ] Setup backups (PostgreSQL daily dumps, uploads/templates volumes)
- [ ] Configure monitoring (GPU/RAM metrics, logs, Redis connectivity)
- [ ] SSL/TLS certificates + Nginx reverse proxy
- [ ] Unit test coverage > 70%
- [ ] Enable pgvector HNSW index for vector search performance
- [ ] Configure Redis TTL for session cleanup

## Security Considerations

- All file uploads validate PDF magic bytes (multer with MIME type filtering)
- SQL injection prevention via Prisma ORM
- Input sanitization (HTML escaping, length limits via Zod validation)
- Per-user choice of OpenRouter, OpenAI, Google Gemini, LM Studio, Ollama, or a compatible provider
- JWT authentication
- Environment variables for sensitive data
- Request timeout middleware prevents hanging connections
- API key encryption at rest (AES-256-GCM) for per-user LLM settings
## Gotchas

- **Missing user LLM config**: generation is rejected until the user saves and tests a provider under Settings.
- **Local provider API format**: LM Studio and custom providers must expose an OpenAI-compatible `/v1/chat/completions` endpoint.
- **Docker networking**: When backend is containerized, use `host.docker.internal` instead of `localhost` for host services.
