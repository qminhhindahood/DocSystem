# 04 — Delete source PDFs after rejected intake

**What to build:** Ensure that once an uploaded PDF has been saved, every later intake rejection or inspection error removes that source promptly and leaves the user's quota untouched.

**Blocked by:** 01 — Unify conversion admission and execution context.

**Status:** ready-for-agent

- [ ] Password-protected PDFs and scanned-page eligibility rejections remove their saved source before the response completes.
- [ ] Unexpected PDF inspection failures also remove the saved source while returning the established safe error contract.
- [ ] Bulk intake cleans each rejected item independently without deleting accepted jobs, and all rejected items remain free.

