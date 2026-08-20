# 02 — Crash-safe queue with quota refund

**What to build:** a worker crash no longer loses Conversion Jobs. Dequeue becomes an atomic pop into a processing list; the worker clears the processing entry when a job reaches a terminal state; on startup the worker reclaims anything left in the processing list by re-queueing it. The job store exposes its Redis client through a public property and every private-attribute reach-through moves onto it. When a conversion ends failed, the submitting user's Quota is refunded — idempotent per job, never below zero.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Dequeue atomically moves the job payload from the queue list to a processing list
- [ ] Terminal job states remove the payload from the processing list
- [ ] Worker startup reclaims (re-queues) every payload left in the processing list
- [ ] The job store exposes a public read-only Redis client property; no module reaches into the private attribute
- [ ] Quota service gains a refund operation; the worker refunds on failed conversion; a job refunds at most once; the counter never goes below zero
- [ ] Durability and refund semantics are tested against a fake Redis client (fakeredis added to dev dependencies)
- [ ] The full conversion-service pytest suite passes
