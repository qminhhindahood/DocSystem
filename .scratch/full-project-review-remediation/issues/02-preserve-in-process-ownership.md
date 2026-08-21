# 02 — Preserve ownership in in-process fallback jobs

**What to build:** Ensure a conversion completed through the in-process fallback remains visible and downloadable by its submitting user while every other user is denied access.

**Blocked by:** 01 — Unify conversion admission and execution context.

**Status:** resolved

- [x] In-process job state retains the same owner identity as queue-backed job state throughout the lifecycle.
- [x] The submitting user can poll, inspect, and download an in-process result through the normal backend API.
- [x] A different authenticated user cannot read or download that job, with regression coverage for queue-unavailable execution.
