# 03 — Refund the original quota charge on every failed conversion

**What to build:** Make every terminal conversion failure refund exactly the quota charge accepted for that job, regardless of execution mode or whether the failure occurs on a later UTC day.

**Blocked by:** 01 — Unify conversion admission and execution context.

**Status:** ready-for-agent

- [ ] Queue-backed and in-process failures refund the original charged quota bucket exactly once.
- [ ] A job admitted before UTC midnight and failed afterward restores the earlier day's charge without changing the new day's usage.
- [ ] Successful jobs are never refunded, and repeated terminal handling cannot create extra quota capacity.

