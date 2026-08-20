# 06 — Frontend prune to the convert surface

**What to build:** the frontend shows only the pure conversion product. The dashboard, documents, generate, QA, and templates pages are deleted with their components and API clients; the convert page, auth pages, and landing remain. Navigation already lists only convert. Absence of the deleted surfaces is asserted by contract tests so they stay deleted.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Only convert, auth (login/signup/forgot/reset), and landing routes remain; deleted pages are gone
- [x] Dead components and API clients (settings, templates, feature panels for generation/QA) are removed
- [x] The proxy allowlist still permits exactly the convert and auth paths the product uses
- [x] A contract test asserts the deleted pages/clients stay absent
- [x] The full frontend suite passes: tests, lint, and production build
