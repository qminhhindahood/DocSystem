# 10 — Remove archived master-stack documentation

**What to build:** Remove the tracked master-stack phase archive so Git history is the only quarantine, and make its absence an enforceable repository contract.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Infrastructure, RAG, Ollama, workflow, and other master-stack phase documents are no longer present in the working tree.
- [x] The repository contract suite fails if the removed archive or equivalent master-stack documentation is reintroduced.
- [x] Active standalone documentation and contributor wayfinding continue to resolve without links to removed material.
