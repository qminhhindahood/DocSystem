# 08 — Master-stack sweep, slim ops, deploy workflow deletion

**What to build:** everything inherited from the master stack that the pure conversion product doesn't use is deleted: the docling service, embeddings service, document renderer, cloudflare worker, terraform infra, deploy directory, DOCX template files, master-stack docs folder, and the header-processing utility. Their CI jobs (renderer, python matrix, terraform, and the docling/embeddings/renderer container entries) are deleted, and the production deploy workflow is removed outright. The ops verification suite shrinks to compose config, the standalone compose contract, the Pester operations tests, and git whitespace integrity; the repository-contracts CI job runs the slim suite.

**Blocked by:** 04 — Backend prune, 06 — Frontend prune (contracts must verify the final state, not a mid-state).

**Status:** done

- [x] The nine master-stack directories/files are deleted; contract tests assert they stay absent
- [x] CI loses the renderer, python, and terraform jobs and the dead container-matrix entries; the repository-contracts job's needs list matches the surviving jobs
- [x] deploy-production.yml is deleted
- [x] ops/verify-all.ps1 runs only compose config, the standalone compose contract, Pester tests, and git whitespace; master-specific suites are deleted
- [x] The slim verify-all passes locally with -ContractsOnly
