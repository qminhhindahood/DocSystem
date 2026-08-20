# ADR-0001: Squash the migration history to a single auth-only init

## Status

Accepted

> **Amendment (BYOK vision settings):** the squashed init migration now also
> creates `UserLLMConfig` (per-user BYOK provider settings: provider, baseUrl,
> model, and an AES-256-GCM-encrypted API key). It was re-added *into the
> squashed baseline* rather than as a follow-up migration because the
> standalone database is fresh-by-design and no deployed instance predates it.
> The migration-integrity lock (`scripts/check_migration_integrity.test.ts`)
> pins the three-model baseline: User, PasswordResetToken, UserLLMConfig.

## Context

This repo is a standalone fork whose product surface is PDF→DOCX conversion plus user auth. The Prisma schema still defines eleven models — nine of them (Document, IngestionJob, Chunk, Feedback, TrainingJob, ModelVersion, Template, UserDocumentProfile, UserLLMConfig) belong to master-stack surfaces that this fork has deleted or is deleting. (UserLLMConfig was later re-introduced, trimmed to the BYOK vision-provider shape — see the amendment above.) The sixteen-migration history carries the master's archaeology (ollama→lmstudio renames, RAG metadata, dynamic templates, summary chunks), and every fresh standalone boot applies all of it, creates nine dead tables, and builds a pgvector HNSW index that nothing queries. The standalone database is fresh by design — it has its own volume and no data worth preserving.

## Decision

Replace the entire migration history with a single clean init migration that creates only the User and PasswordResetToken models. Swap the Postgres image from the pgvector variant to plain postgres:15-alpine, drop the vector extension from the init script, and delete the pgvector/HNSW boot wiring from the backend. The compose migrate service applies the one migration.

## Consequences

- Fresh deploys apply one migration; the schema matches the pruned product exactly.
- Anyone needing the old schema or history recovers it from git — history is the quarantine.
- The squash is hard to reverse in the sense that the old migration chain will never be reapplied to this product's databases; that is the point.
- If generation/RAG surfaces are ever brought back into this repo, their tables return as new migrations from the squashed baseline, not by restoring the old chain.
