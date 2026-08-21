# 09 — Remove the out-of-scope OpenRouter and Q&A surface

**What to build:** Keep settings and APIs focused on the standalone conversion product by removing OpenRouter model discovery, credentials, and future-Q&A messaging while retaining owner-scoped Gemini vision configuration.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Users can configure and remove their Gemini vision key without seeing OpenRouter or future-Q&A controls.
- [ ] OpenRouter catalog endpoints, provider integration, stored credential fields, and unused dependencies are removed safely.
- [ ] Repository contracts and tests assert that the Q&A surface remains absent and that Gemini secrets remain encrypted and owner-scoped.

