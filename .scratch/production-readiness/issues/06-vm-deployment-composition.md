# 06 — VM deployment composition (Caddy + prod overlay)

Status: open
Blocked by: (none)

## Why

Q15/Q22: the whole stateful stack deploys to one Oracle Always Free ARM VM
behind Caddy TLS on `api.<domain>`; deploys are build-on-VM. No deploy
scaffolding exists in the repo today (verified: zero Caddy/nginx/Traefik
references).

## Scope

- `docker-compose.prod.yml`: overlay adding a `caddy` service
  (image: caddy:2-alpine, ports 80/443, volume for Caddy data + ACME account),
  and env hardening for the app services:
  `SESSION_COOKIE_SECURE=true`, `TRUST_PROXY_HOPS=1`, HTTPS
  `CORS_ORIGIN=https://app.<domain>` (via `.env` on the VM), and the
  frontend service removed from the prod composition (it lives on
  Cloudflare Pages).
- `Caddyfile`: `api.<domain>` reverse-proxy → backend:3001; header
  `X-Forwarded-For`/`X-Forwarded-Proto` passthrough (Caddy default), request
  body limit ≥ 50MB explicit.
- `docs/runbook.md`: VM setup steps (Oracle ARM shape, Docker install,
  git clone, .env template with all prod values, first-boot order:
  postgres → migrate → backend/redis/conversion → storage-init), deploy
  command, rollback (previous image IDs, `docker compose down` safe path).
- Ops Pester test `ops/tests/ProdCompose.Tests.ps1`: overlay + base compose
  `config --quiet` passes; caddy service present; frontend absent; env
  hardening keys present in the merged config.

## Acceptance

- [ ] `docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet`
      passes locally on the dev machine.
- [ ] Pester test asserts the overlay shape (caddy present, frontend absent,
      hardening keys set) — red first, then green.
- [ ] Runbook covers setup, deploy, rollback, and first-boot migration order.
- [ ] No secrets in the overlay or Caddyfile (all via VM `.env`).
