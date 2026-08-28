# ADR-0001: Squash the migration history to a single auth-only init

## Status

Accepted

> **Amendment (BYOK vision settings):** the squashed init migration now also
> creates `UserLLMConfig` (per-user BYOK provider settings: provider, baseUrl,
> model, and an AES-256-GCM-encrypted API key). It was re-added *into the
> squashed baseline* rather than as a follow-up migration because new
> standalone installations start from that baseline. The compatible-volume
> amendment below governs installations that already have product tables.
> The migration-integrity lock (`scripts/check_migration_integrity.test.ts`)
> pins the three-model baseline: User, PasswordResetToken, UserLLMConfig.

> **Amendment (compatible standalone volumes):** the fresh-by-design assumption
> did not hold for every local standalone volume. A database with all three
> current tables but no Prisma migration history may be baselined by marking the
> squashed init migration applied before deployment. Compatibility requires the
> current columns, types, primary and unique relationships, foreign keys, and no
> extra required column without a default. Unrelated legacy tables and harmless
> nullable or defaulted columns are permitted. Partial or divergent schemas fail
> closed with backup-safe instructions. The compatibility path never creates,
> drops, truncates, or rewrites user tables.

## Context

This repo is a standalone fork whose product surface is PDF→DOCX conversion plus user auth. The Prisma schema still defines eleven models — nine of them (Document, IngestionJob, Chunk, Feedback, TrainingJob, ModelVersion, Template, UserDocumentProfile, UserLLMConfig) belong to master-stack surfaces that this fork has deleted or is deleting. (UserLLMConfig was later re-introduced, trimmed to the BYOK vision-provider shape — see the amendment above.) The sixteen-migration history carries the master's archaeology (ollama→lmstudio renames, RAG metadata, dynamic templates, summary chunks), and every fresh standalone boot applies all of it, creates nine dead tables, and builds a pgvector HNSW index that nothing queries. New installations use an isolated volume, while compatible existing standalone volumes receive the guarded baseline described above.

## Decision

Replace the entire migration history with a single clean init migration that creates only the User and PasswordResetToken models. Swap the Postgres image from the pgvector variant to plain postgres:15-alpine, drop the vector extension from the init script, and delete the pgvector/HNSW boot wiring from the backend. The compose migrate service applies the one migration.

## Consequences

- Fresh deploys apply one migration; the schema matches the pruned product exactly.
- Compatible pre-baseline standalone volumes retain their data and receive a
  Prisma migration baseline before deployment.
- Partial or divergent untracked schemas require explicit operator migration;
  startup never guesses at destructive repair.
- Anyone needing the old schema or history recovers it from git — history is the quarantine.
- The squash is hard to reverse in the sense that the old migration chain will never be reapplied to this product's databases; that is the point.
- If generation/RAG surfaces are ever brought back into this repo, their tables return as new migrations from the squashed baseline, not by restoring the old chain.
