# Security Baseline

These requirements are mandatory for production readiness.

## Required Secrets

Do not commit `.env` files. Commit only `.env.example` files with placeholders.

Required backend values:

```env
DATABASE_URL="postgresql://airabbit:<strong-password>@localhost:5432/airabbit"
JWT_SECRET="<at-least-32-random-bytes>"
REGISTRATION_INVITE_CODE="<random-invite-code>"
OLLAMA_URL="http://localhost:11434"
OLLAMA_MODEL="qwen3.6:14b"
REDIS_URL="redis://localhost:6379"
DOCLING_URL="http://localhost:8001"
EMBEDDINGS_URL="http://localhost:8002"
CLAMAV_HOST="localhost"
CLAMAV_PORT="3310"
```

Required infrastructure values:

```env
DB_PASSWORD="<strong-password>"
```

Docker Compose must fail closed when required secrets are missing:

```yaml
POSTGRES_PASSWORD: ${DB_PASSWORD:?DB_PASSWORD is required}
```

## Authentication

- All API routes except `/health`, `/api`, `/api/auth/register`, and `/api/auth/login` require JWT auth.
- Registration requires `REGISTRATION_INVITE_CODE`.
- Store password hashes only; never store plaintext passwords.
- Include `Authorization: Bearer <token>` on frontend API calls.

## Validation

- Validate route params, query strings, JSON bodies, and upload metadata with schema validation.
- Enforce maximum lengths for prompts, RAG queries, generated content, and feedback payloads.
- Clamp numeric controls such as `topK`, `limit`, and `threshold`.
- Reject unknown `docType` values.

## SQL and Database

- Never concatenate user input into raw SQL.
- Use Prisma ORM or parameterized `Prisma.sql`.
- Use a singleton Prisma client to avoid connection pool exhaustion.

## Uploads

PDF uploads must enforce:

- single file per request
- maximum file size
- `.pdf` extension
- `%PDF-` magic-byte validation
- virus scanning before parsing or indexing
- safe temporary file handling in Python services

Production must fail closed if virus scanning is unavailable.

## Service Reliability

- Every outbound service call must have a timeout.
- Embedding failures must throw an error; never return zero vectors.
- Health checks must verify real readiness, not just process liveness.
- Streaming parsers must handle multi-line and split-line chunks.

