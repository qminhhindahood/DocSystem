# ADR-0002: Hybrid free-tier production deployment (Oracle VM + Cloudflare)

## Status

Accepted

## Context

The standalone conversion service must go to production for a 3–10 user pilot
at zero recurring cost. The repo ships a single `docker compose` stack with
three stateful coupling points: a Redis queue consumed by a long-running
worker (BRPOPLPUSH + startup reclaim), shared filesystem volumes
(`uploads_data`, `conversion_work`), and Postgres. Candidate platforms
were evaluated against free tiers (grill session 2026-08-29):

- Vercel serverless functions cap request bodies at ~4.5MB while the product
  accepts 50MB scanned-PDF uploads — the core use case dies at the edge.
- Cloud Run's free tier (180k vCPU-sec/month) cannot host an always-on queue
  worker (~2.6M vCPU-sec/month at 24/7); a serverless refactor of the worker
  adds the largest workstream on the board while preserving the same
  always-on requirement elsewhere.
- No free managed Postgres or Redis exists on GCP; Oracle Always Free
  provides 4 Ampere A1 OCPUs, 24GB RAM, 200GB disk — enough to run the
  entire existing stack unchanged on ARM64 (all base images are multi-arch;
  PyMuPDF ships ARM64 wheels).
- The user already owns a domain hosted on Cloudflare.

The frontend never talks to the backend directly from the browser — all
traffic rides the Next.js server proxy (`/api/proxy/*`, cookie→Bearer
conversion server-side). So the frontend can live on a separate platform
from the backend provided that platform forwards large bodies.

## Decision

Deploy hybrid on free tiers:

- **Oracle Always Free ARM VM**: the entire compose stack (postgres, redis,
  conversion, conversion-worker, backend) behind **Caddy** providing automatic
  TLS on `api.<domain>`. Deploys are build-on-VM: `git pull` +
  `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`
  (ARM-native builds; no multi-arch registry, no CI/CD pipeline).
- **Cloudflare Pages** hosts the frontend via the `@opennextjs/cloudflare`
  adapter (~100MB body limit preserves the 50MB upload cap); the proxy route
  targets `https://api.<domain>`.
- **Nightly Postgres backups** (`pg_dump`) to VM disk, synced to GCS free
  tier (30-day retention), with a monthly restore drill documented in the
  runbook. Uploads/work volumes are deliberately not backed up (in-flight
  files are user-held and re-derivable).
- Production env hardening lives in a `docker-compose.prod.yml` overlay:
  `SESSION_COOKIE_SECURE=true`, `TRUST_PROXY_HOPS=1` (Caddy hop), HTTPS
  `CORS_ORIGIN` = the Pages frontend origin.

## Consequences

- Zero recurring cost; the whole pilot runs on Oracle's always-free quota
  with headroom (the full stack idles far below 24GB/4 OCPU).
- The architecture stays compose-native: the repo's own cutover checklist
  and preflight apply nearly verbatim on the VM.
- File uploads are capped by Cloudflare's ~100MB body limit, comfortably
  above the product's 50MB cap — no code change to the upload path.
- A single VM is a single failure domain and a hard ceiling (~200GB disk,
  4 OCPU). Acceptable for 3–10 users; scale-out (or the serverless refactor
  of the worker + object storage) becomes the next ADR if the pilot grows.
- Secrets live in VM env vars; `LLM_CONFIG_ENCRYPTION_KEY` additionally has
  one offline escrowed copy — Neon/GCS backups do not protect it.
- Monitoring hookup (UptimeRobot + Grafana Cloud free → Telegram/email) is
  wiring-only once the pilot owner provides alert materials.
