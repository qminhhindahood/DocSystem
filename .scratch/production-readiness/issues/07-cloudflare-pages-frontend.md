# 07 — Cloudflare Pages frontend via OpenNext

Status: resolved
Blocked by: (none)

## Why

Q19(b): Vercel's ~4.5MB serverless body limit would kill 50MB scanned-PDF
uploads; Cloudflare Pages via `@opennextjs/cloudflare` keeps ~100MB bodies
and requires no auth-model change (all browser traffic rides the server
proxy). The user already hosts their domain on Cloudflare.

## Scope

- Frontend: add `@opennextjs/cloudflare` adapter, `wrangler.toml`/build
  config (`nodejs_compat` flag, compatibility date), build command
  `opennextjs-cloudflare build` (or adapt the existing `npm run build`).
- `BACKEND_API_URL=https://api.<domain>` as a Pages env var (runtime, not
  baked — verify the adapter preserves runtime env reading in the proxy
  route).
- Cookie notes: the session cookie is set by the frontend's own
  `/api/session/*` routes (frontend-origin) and the proxy forwards Bearer —
  no cross-domain cookie needed. `SESSION_COOKIE_SECURE=true`.
- CORS: backend `CORS_ORIGIN=https://app.<domain>` (ticket 06 overlay).
- Deploy via Cloudflare Pages git integration (push to branch → build).
- Update `.gitignore` if the adapter emits any artifacts.

## Scope note

The adapter must support Next.js 16 — verify version compatibility on first
implementation attempt; if `@opennextjs-cloudflare` doesn't support 16 yet,
fallback options: (a) Next.js static export loses the proxy route → not
acceptable; (b) self-host the frontend container on the VM too (abandons
hybrid, simplest, keeps TLS via Caddy `app.<domain>`) — decide with the
user at that point.

## Acceptance

- [ ] Local build with the adapter succeeds (`opennextjs-cloudflare build`).
- [ ] Deployed preview proxies to the VM backend over TLS; login works;
      upload of a >4.5MB PDF succeeds (proves the body limit is not 4.5MB).
- [ ] Session cookie flags: Secure, SameSite=Lax, HttpOnly on the pages.dev
      custom domain.
- [ ] Frontend suite green; no test regressions from adapter config.

## Implementation answers (2026-01 session)

- **Adapter version**: @opennextjs/cloudflare@1.20.4 (peer range
  `>=16.3.3` — required bumping next 16.2.11 → 16.3.3, npm `latest` tag;
  full vitest suite 236/236 green after the bump).
- **Build proven locally**: `npx opennextjs-cloudflare build` completes —
  worker saved to `.open-next/worker.js` (middleware, static assets, cache
  assets, server function bundled).
- **Runtime env read — empirically verified under workerd**: `wrangler dev`
  with `.dev.vars` BACKEND_API_URL — the worker's proxy route fetched the
  exact .dev.vars target (first 127.0.0.1:3101, then the LAN IP after
  editing), NOT the localhost fallback. This proves the adapter's
  populateProcessEnv + our per-call read work end-to-end. (The fetch itself
  502s locally because workerd's sandbox blocks host loopback/LAN — an
  infra quirk, not the app; deployed Workers reach the public Caddy edge
  normally.)
- **Code fix the verification forced**: BOTH backend.ts and the proxy
  route captured `process.env.BACKEND_API_URL` into module-load consts —
  on Workers that freezes to the localhost fallback (env vars land at
  request time). Fixed to per-call reads via `backendUrl()`; locked by
  red-first vitest tests (backend.test.ts, proxy-route-env.test.ts) and
  Pester source contracts.
- **Config**: wrangler.jsonc (nodejs_compat + global_fetch_strictly_public,
  assets binding, self-reference service for revalidate patch; no R2
  cache/images bindings — app uses no next/image or ISR),
  open-next.config.ts with defineCloudflareConfig(). BACKEND_API_URL is
  a dashboard runtime variable — never in wrangler `vars` (Pester-enforced).
- **CI**: frontend job now runs `npx opennextjs-cloudflare build` after the
  regular build. Scripts: build:worker, preview:worker. .gitignore:
  .open-next/, .wrangler/, .dev.vars*.
- **Docs**: runbook §7 (setup via git integration, deploy, session cookie
  flags, post-deploy verification incl. >4.5MB upload proof), CLAUDE.md
  frontend notes.
- **Not done here (needs the real Cloudflare account)**: dashboard connect,
  custom domain, prod variable set, the live >4.5MB upload test, and
  cookie-flag observation on the real pages.dev domain — those are the
  human steps recorded in runbook §7.1/§7.4 and the cutover checklist
  (ticket 08).
