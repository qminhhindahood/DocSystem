# 07 — Cloudflare Pages frontend via OpenNext

Status: open
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
