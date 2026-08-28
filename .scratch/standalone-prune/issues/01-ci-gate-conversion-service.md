# 01 — CI gate for the conversion service

**What to build:** the conversion service becomes visible to CI: a dedicated job runs its pytest suite on every PR, and the containers matrix builds its image and scans it with the same pinned Trivy action and severity policy as the other images. The product's core is no longer shipped untested or unscanned.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] CI gains a conversion job that installs the service's runtime and dev requirements and runs its pytest suite
- [x] The containers matrix gains a conversion entry built from the service's Dockerfile with the correct build context
- [x] The conversion image is scanned by the existing SHA-pinned Trivy action with the same CRITICAL,HIGH severity gate and failing exit code
- [x] The CI workflow still passes end-to-end (yaml valid, no job references a removed path)
