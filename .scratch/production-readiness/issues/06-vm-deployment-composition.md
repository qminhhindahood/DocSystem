# 06 — VM deployment composition (Caddy + prod overlay)

Status: resolved
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

## Implementation answers (2026-01 session)

- **Frontend removal mechanism**: compose `profiles: ["cloudflare-only"]` in
  the overlay — a profile the VM never activates, so the merged prod
  composition excludes the frontend while plain dev compose still runs it.
  Verified empirically: merged prod `config --services` lists 8 services
  (no frontend, +caddy); dev lists 9 (frontend present).
- **Empirical validation** (against the real `caddy:2-alpine` image via
  `docker cp` — bind mounts are broken on this host): `caddy validate`
  initially REJECTED the draft Caddyfile — `request_body` needs a `route`
  block, and an unset `API_DOMAIN` makes Caddy parse the site block as
  global options. Both fixed; `caddy validate` now returns **Valid
  configuration** with API_DOMAIN set (runbook §6.1 documents the trap).
- **CORS_ORIGIN guard**: overlay uses the compose `:?` required-variable
  guard — deploy without it fails loudly (Pester asserts both directions:
  passes when set, exit 1 when missing).
- **Body limit**: 64MB at the edge (≥ backend's 50MB) inside a `route`
  block; Caddy passes X-Forwarded-* by default and TRUST_PROXY_HOPS=1.
- **Runbook §6**: VM setup (Oracle ARM shape, iptables + security list,
  Docker install, clone, .env templates for root + backend), first-boot
  order (postgres → migrate → backend/redis/conversion → storage-init →
  caddy, enforced by depends_on and stated), deploy command, rollback
  (git checkout + rebuild; `down` without `-v` never touches volumes;
  forward-only migrations per ADR-0001, dump restore as last resort).
- **Tests**: 15 Pester checks (grew from the 12 first draft with the
  CORS_ORIGIN guard pair and the API_DOMAIN label check). Full ops
  directory: 57/57 green. Merged compose `config --quiet` passes locally
  with the required env vars set.
- **Registry**: CLAUDE.md env section documents CORS_ORIGIN/API_DOMAIN
  as production-only values with the Caddy empty-label trap noted.
