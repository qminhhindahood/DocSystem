# 07 — One-command product: frontend compose service

**What to build:** the frontend joins the compose stack as a production-built service, proxying to the backend, so one `docker compose up` runs the entire product — database, queue, conversion, worker, backend, frontend. The README quick start reflects the one-command story.

**Blocked by:** 06 — Frontend prune (the image should ship the pruned surface).

**Status:** done

- [x] The frontend gains a production Dockerfile using the Next.js standalone output
- [x] Compose defines a frontend service wired to the backend with the correct proxy target
- [x] `docker compose config` validates; the standalone compose contract test covers the new service
- [x] README quick start documents the one-command flow
