# 09 — Documentation rewrite

**What to build:** CLAUDE.md and PRODUCT.md describe the product that actually exists. CLAUDE.md is rewritten for the standalone conversion product — architecture, quick start, ports, environment, testing, gotchas — matching the pruned reality. PRODUCT.md is rewritten as the conversion product's register (users, purpose, anti-references, principles) consistent with the README.

**Blocked by:** 01–08 — every other ticket (docs describe the final state).

**Status:** done

- [x] CLAUDE.md contains no reference to removed surfaces (RAG, generation, QA, templates, feedback/LoRA, LM Studio, NeMo, docling, embeddings, renderer)
- [x] CLAUDE.md's architecture, ports, quick start, and testing sections match the pruned repo exactly
- [x] PRODUCT.md is the conversion product's register, consistent with the README
- [x] README is reconciled with any changes the earlier tickets introduced (compose services, CI jobs, ops suite)
