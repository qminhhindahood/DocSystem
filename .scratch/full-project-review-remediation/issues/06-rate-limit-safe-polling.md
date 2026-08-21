# 06 — Make status polling compatible with API rate limits

**What to build:** Let users monitor single and ten-job bulk conversions through completion without ordinary polling exhausting the shared API rate limit.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Polling traffic has a rate-limit policy or aggregation strategy sized for the documented single and ten-job bulk workflows.
- [ ] General API abuse protection remains active for non-polling endpoints.
- [ ] Polling stops for terminal jobs and unmounted views, with tests proving sustained bulk monitoring does not receive routine HTTP 429 responses.
