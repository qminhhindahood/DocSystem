# 03 — Admin password-reset script (one-shot container run)

Status: resolved
Blocked by: (none)

## Why

Q14/Q17: password reset stays disabled in the pilot, but a forgotten
password must not permanently orphan an account (old jobs/reports are
owner-scoped to the dead account; the user would need to re-register AND
re-enter their BYOK Gemini key). User accepted the consequence ("yea") and
approved the small admin-reset script.

## Scope

- `backend/scripts/reset_password.js`: run via
  `docker compose run --rm backend node dist/scripts/reset_password.js --email <e> --new-password <p>`
  (compiled into `dist/scripts` by the existing build). Argv-based; no env
  secrets needed beyond what the backend already requires.
- Updates the user's `passwordHash` via Prisma. Old sessions keep working
  (JWTs are stateless) — documented in the runbook.
- `docs/runbook.md` (or README section): exact command, prerequisites
  (migrate already applied), and the note that old JWTs remain valid until
  expiry.

## Acceptance

- [ ] New test: script (or its core function) resets a test user's password;
      old hash no longer verifies, new one does.
- [ ] Compile into `dist/scripts` in the backend Docker build (no Dockerfile
      change if `tsc` already emits scripts/ — verify).
- [ ] Backend suite green.
- [ ] Runbook section exists with the copy-paste command.
