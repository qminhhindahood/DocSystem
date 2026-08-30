# 03 — Owner-scoped job reads

**What to build:** a Conversion Job's status, report, and result are visible only to the user who submitted it. The internal conversion service surfaces the job's owning user in its status and report responses; the backend compares it against the authenticated user before returning anything. Unknown job and not-your-job are indistinguishable to the caller (both 404), so job ids are never confirmed to strangers.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] The internal service's status and report responses include the owning user id
- [x] Backend status, report, and result reads return 404 when the job's owner differs from the authenticated user
- [x] A job state without an owning user is denied, not allowed
- [x] The result download performs the ownership check before streaming the DOCX
- [x] Contract tests cover: owner can read, non-owner gets 404, unknown job gets 404
- [x] The full backend test suite passes
