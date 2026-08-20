# 05 — Squash to an auth-only schema

**What to build:** executes ADR-0001. The sixteen-migration history is replaced by a single clean init migration creating only the User and PasswordResetToken models. The Postgres image swaps from the pgvector variant to plain postgres:15-alpine, the vector extension leaves the init script, and the pgvector/HNSW boot wiring disappears from the backend. The compose migrate service applies the one migration on a fresh boot.

**Blocked by:** 04 — Backend prune (models cannot drop while deleted routes' services still compile against them).

**Status:** done

- [x] One init migration creates exactly the User and PasswordResetToken models; the old migration chain is gone
- [x] schema.prisma defines only those two models
- [x] Compose uses plain postgres:15-alpine; init.sql no longer creates the vector extension
- [x] The backend boots and passes its suite with no pgvector/HNSW wiring
- [x] A fresh `docker compose up` applies the single migration cleanly (compose config + migrate service contract)
