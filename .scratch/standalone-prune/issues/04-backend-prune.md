# 04 — Backend prune to the convert surface

**What to build:** the backend serves only the pure conversion product. All master-stack routes (QA, RAG, workflow, templates, feedback, LLM settings, documents, document profiles) and the services they depend on are unmounted and deleted; the ingestion and template-compilation workers and their boot wiring are gone; the readiness service probes only Postgres, Redis, and the conversion service, so health stops being permanently degraded. The API root listing, per-endpoint rate limiters, and long-running-path set reference only surviving endpoints. Deletions are locked by extended removed-surfaces contract tests.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Only auth, convert, and health endpoints remain mounted; pruned routes return 404
- [x] Deleted routes' services, workers, and boot wiring are removed; the server boots without them
- [x] Readiness reflects only Postgres, Redis, and the conversion service; health returns 200 when those are up
- [x] The removed-surfaces contract test pattern is extended to assert the new deletions stay absent
- [x] The full backend test suite passes (deleted routes' contract tests removed with them)
