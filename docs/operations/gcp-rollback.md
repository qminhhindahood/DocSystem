# Production application rollback

Rollback changes Cloud Run traffic only. It does not revert a database migration and must never edit Prisma migration history.

## Decision

Use rollback when a promoted frontend/backend revision regresses but the preceding revisions remain compatible with the current forward-only schema. If the schema is incompatible, stop traffic promotion and restore the pre-migration backup to a new instance following the restore drill; never restore over production.

## Procedure

1. Preserve the failed workflow URL, commit, image digest, revision, migration ID, and smoke output.
2. List the two most recent revisions for `docai-backend` and `docai-frontend` and confirm the selected previous revisions are schema-compatible.
3. Run `ops/gcp/rollback.ps1` with explicit project and region. Supply frontend/backend URLs, a PDF ingestion fixture, and a DOCX template fixture so authenticated smoke reruns after traffic restoration.
4. Confirm both services route 100% to the intended previous revisions. Confirm private services still reject unauthenticated calls with 403.
5. Verify live/ready, login, settings, template list, fixture ingestion/render/download, Q&A completion, and fixture cleanup.
6. Record the restored revisions and smoke result. Open a forward-fix change; do not force-push or mutate migration files.

If smoke fails after rollback, remove public traffic from the affected path, retain evidence, and begin new-instance database recovery if the failure is data-related.
