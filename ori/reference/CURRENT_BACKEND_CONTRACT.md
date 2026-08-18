# Current Backend Contract

This document is the source of truth for backend examples in the `ori` planning docs.

The backend target is **Express.js + TypeScript**, with Python reserved for microservices:

- `docling-service`: PDF parsing.
- `embeddings-service`: embedding generation.
- `lora-service`: fine-tuning jobs.

Do not implement core API routes as FastAPI unless the architecture is intentionally changed.

## Required Backend Modules

```text
backend/src/
  index.ts
  config.ts
  db.ts
  middleware/
    auth.ts
    validate.ts
  routes/
    auth.ts
    workflow.ts
    rag.ts
    feedback.ts
  services/
    auth_service.ts
    ollama_service.ts
    rag_service.ts
    feedback_service.ts
    state_store.ts
    stream_parser.ts
    upload_security.ts
  validation/
    schemas.ts
```

## API Routes

| Route | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/health` | `GET` | No | Readiness check for database, Redis, Docling, embeddings, and Ollama |
| `/api/auth/register` | `POST` | No | Invite-code user registration |
| `/api/auth/login` | `POST` | No | JWT login |
| `/api/auth/me` | `GET` | Yes | Current authenticated user |
| `/api/workflow/types` | `GET` | Yes | Supported document types |
| `/api/workflow/template/:documentType` | `GET` | Yes | Template metadata and content |
| `/api/workflow/generate` | `POST` | Yes | Non-streaming document generation |
| `/api/workflow/stream` | `POST` | Yes | SSE document generation |
| `/api/workflow/validate` | `POST` | Yes | Decree 30/2020 validation |
| `/api/rag/search` | `POST` | Yes | Vector search |
| `/api/rag/index` | `POST` | Yes | Safe PDF upload and indexing |
| `/api/feedback/submit` | `POST` | Yes | Store edit feedback |
| `/api/feedback/stats` | `GET` | Yes | Feedback statistics |
| `/api/feedback/training-check` | `GET` | Yes | LoRA trigger readiness |
| `/api/feedback/training-samples` | `GET` | Yes | Training sample export |

## Naming Rules

Use these names consistently:

- Request field: `docType`
- Document types: `quyet-dinh`, `chi-thi`, `bao-cao`, `cong-van`, `thong-bao`
- Legacy aliases `cong-hoa` and `ban-ao` should only appear in migration or compatibility notes.

## Route Shape Examples

```ts
router.post('/search', requireAuth, validate('body', ragSearchSchema), async (req, res) => {
  const { query, topK, docType } = req.body;
  const results = await ragService.search(query, topK, docType);
  res.json({ success: true, query, results, count: results.length });
});
```

```ts
router.post('/stream', requireAuth, validate('body', workflowGenerateSchema), async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const { prompt, docType } = req.body;
  const outline = await planner.createOutline(prompt, docType);
  const researchResults = await researcher.research(outline, docType);

  for await (const chunk of writer.streamWrite(outline, researchResults, prompt, docType)) {
    res.write(`data: ${JSON.stringify({ stage: 'writing', chunk })}\n\n`);
  }

  res.write(`data: ${JSON.stringify({ stage: 'complete', done: true })}\n\n`);
  res.end();
});
```

## Prisma Rules

- Use one shared Prisma client from `backend/src/db.ts`.
- Use Prisma ORM for normal CRUD.
- Use parameterized `$queryRaw`/`Prisma.sql` for pgvector queries.
- Never use `$executeRawUnsafe` for user-influenced SQL.

## Streaming Rules

- Ollama streaming chunks can contain multiple JSON lines or partial JSON lines.
- Always parse with a buffer and preserve incomplete trailing data for the next chunk.
- Frontend SSE parsing must also buffer partial lines.

