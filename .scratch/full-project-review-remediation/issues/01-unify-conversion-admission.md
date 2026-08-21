# 01 — Unify conversion admission and execution context

**What to build:** Give single and bulk submissions one shared admission flow that produces the same owner-scoped execution context for queued and in-process conversion, including the identity of the quota charge that was accepted.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Single and bulk submissions use one admission contract for validation, scanned-page eligibility, quota charging, and execution dispatch.
- [x] The admitted execution context identifies the owning user and the exact quota charge without changing successful conversion behaviour.
- [x] Queue and in-process adapters consume the same context, with parity tests covering both submission modes and both execution modes.
