# Production Operations and Cutover Implementation Plan

> **Execution:** Run after `2026-08-31-production-runtime-hardening.md` using `superpowers:executing-plans` inline. The final live cutover remains gated on credentials, the real domain, and explicit human confirmations.

**Goal:** Produce a repeatable main-branch release path for Cloudflare Free + OCI Always Free-only, encrypted GCS backups, free provider-native monitoring, automatic application rollback, and a human-safe cutover wizard.

**Architecture:** GitHub CI is the merge gate. Cloudflare deploys the Worker from `main`; the OCI VM deploy helper accepts only an exact commit that is contained in `origin/main`, keeps rollback images, and restores the prior application revision when health checks fail. Backups are encrypted locally with `age` before leaving the VM. GCP uptime checks and OCI custom metrics/alarms notify the operator's email.

**Decision source:** `.scratch/production-readiness/spec.md`

## Global constraints

- The recovery private key exists only in the user's password manager; never write it to the repository, VM, GCP, Cloudflare, OCI, logs, or wizard state.
- No raw `.pgdump` may remain after a successful or failed backup attempt.
- GCS keeps encrypted backup objects for 30 days. Target RPO is 24 hours; target RTO is 8 waking hours; there is no overnight response guarantee.
- `main` is the only production source. Never deploy a feature branch or a dirty checkout.
- Application health-check failure may trigger automatic rollback. Database restore, volume deletion, paid scaling, and secret rotation always stop for direct approval.
- Keep Cloudflare on the free plan and provision OCI A1 at exactly 2 OCPU / 12 GB; the current Oracle account cannot create paid resources.
- Treat successful A1 provisioning as a hard gate. Never fall back to an OCI AMD micro or GCP e2-micro for this stack, and never generate artificial load to evade Oracle's idle-instance reclamation policy.
- A paid GCP e2-medium-class VM is a documented fallback only; creating it requires a fresh cost review and explicit operator approval.
- The wizard guides only the steps requiring the human's account/session/secret access. Static verification is allowed; do not run the wizard end-to-end during implementation.

---

## Task 1: Client-side encrypted nightly backups

**Files:**
- Modify: `ops/backup/postgres-dump.sh`
- Modify: `ops/backup/sync-to-gcs.sh`
- Create: `ops/backup/restore-postgres.sh`
- Modify: `ops/tests/BackupScripts.Tests.ps1`
- Modify: `docs/runbook.md`

**Interfaces:**
- Backup requires `AGE_RECIPIENT`; output is `${POSTGRES_DB}-${UTC_STAMP}.pgdump.age`.
- Plaintext dump uses a restrictive `mktemp` path, `umask 077`, and an EXIT trap that always deletes it.
- Sync uploads only `*.pgdump.age`; GCS lifecycle deletes objects after 30 days.
- Restore requires `AGE_IDENTITY_FILE`, decrypts to a guarded temporary path, runs `pg_restore --clean --if-exists` only after typing `RESTORE <database>`, and deletes plaintext on exit.

- [ ] Extend Pester contracts to require `age --encrypt`, `AGE_RECIPIENT`, encrypted suffix, plaintext cleanup trap, encrypted-only sync, and explicit restore confirmation; confirm RED.
- [ ] Implement the backup script using a temporary raw dump, validate raw size ≥1024 bytes, encrypt to a temporary `.age` file, atomically rename, and prune only encrypted local backups older than 30 days.
- [ ] Restrict GCS sync to a temporary staging directory of hard links/copies matching `*.pgdump.age`; never rsync arbitrary backup-directory contents.
- [ ] Implement the guarded restore helper. This script is destructive and must never be invoked by automated deployment.
- [ ] Rerun Pester and `bash -n` for all three scripts.
- [ ] Update the runbook with `age-keygen`, recipient storage, cron, GCS lifecycle JSON/command, restore drill, RPO/RTO, and quarterly drill log. Never include an example private key.

---

## Task 2: Provider-native free monitoring and email alarms

**Files:**
- Create: `ops/monitoring/collect-health.sh`
- Create: `ops/monitoring/publish-oci-metrics.sh`
- Create: `ops/tests/MonitoringScripts.Tests.ps1`
- Modify: `ops/verify-all.ps1`
- Modify: `docs/runbook.md`

**Interfaces:**
- `collect-health.sh` emits one compact JSON object containing `queue_depth`, `disk_used_percent`, `backup_age_seconds`, and `unhealthy_container_count`.
- `publish-oci-metrics.sh` requires `OCI_MONITORING_COMPARTMENT_ID`, calls the collector, validates numeric values, and publishes namespace `docai` with dimensions `{host,service}` through the OCI CLI.
- Alarm thresholds: queue depth ≥80 for 10 minutes; disk ≥80% for 15 minutes; backup age ≥129600 seconds; unhealthy containers ≥1 for 5 minutes.
- GCP public uptime checks cover `https://app.<domain>/api/live` and `https://api.<domain>/health`; email notification is the only alert channel for launch.

- [ ] Write behavior-oriented tests that execute both shell scripts with fake `docker`, `redis-cli`, `df`, `find`, and `oci` commands on `PATH`; assert exact JSON/metric payloads and loud failure on malformed values. Confirm RED.
- [ ] Implement deterministic collectors with overridable command variables for tests and no secrets in output.
- [ ] Add the new suite to the canonical operations verifier and confirm GREEN.
- [ ] Document exact OCI CLI commands for dynamic-group/policy or instance-principal setup, alarm creation, email subscription confirmation, and a systemd timer every five minutes.
- [ ] Document exact `gcloud monitoring uptime create`/notification-channel steps and require one deliberately triggered test email before launch.
- [ ] Remove UptimeRobot/Grafana requirements and retain a manual health-check fallback.

---

## Task 3: Main-only release with automatic application rollback

**Files:**
- Create: `ops/deploy-production.sh`
- Create: `ops/tests/DeployProduction.Tests.ps1`
- Modify: `.github/workflows/ci.yml`
- Modify: `ops/tests/GitHubWorkflow.Tests.ps1`
- Modify: `docs/runbook.md`

**Interfaces:**
- Usage: `ops/deploy-production.sh <40-character-main-commit>`.
- Preconditions: repository clean, requested SHA exists, `git merge-base --is-ancestor <sha> origin/main` succeeds, local main fast-forwards to origin, and `<sha>` equals `origin/main^{commit}` unless `ALLOW_OLDER_MAIN_COMMIT=true` is explicitly set for rollback recovery.
- Captures previous commit and image IDs for backend/conversion/Caddy. On failed readiness, checks out the previous commit detached, restores prior image tags, recreates application containers without database mutation, and exits nonzero.
- Health gate: backend `/health`, conversion `/health`, public API health, and frontend `/api/ready` succeed for three consecutive checks within five minutes.

- [ ] Add CI contract test proving both pull requests and pushes to `main` run the full workflow; confirm RED.
- [ ] Add `push: branches: [main]` to CI and confirm GREEN.
- [ ] Write deploy-script behavior tests with fake `git`, `docker`, and `curl` binaries for: feature-branch SHA rejection, dirty checkout rejection, healthy deploy, failed health rollback, and a guarantee that no `prisma migrate reset`, volume removal, `git reset --hard`, or secret rotation appears. Confirm RED.
- [ ] Implement the release helper with a rollback trap armed only after previous state has been captured. Database migration remains the existing forward-only startup gate.
- [ ] Rerun tests and `bash -n`; document normal deploy, automatic rollback evidence, and manual recovery from detached rollback state.

---

## Task 4: Repair the human cutover wizard

**Files:**
- Modify: `ops/cutover-wizard.sh`
- Create: `ops/tests/CutoverWizard.Tests.ps1`
- Modify: `ops/verify-all.ps1`

**Implementation rules:**
- Replace the library section above `# === STAGES ===` byte-for-byte from the canonical wizard skill template. Author only stages, predicates, probes, summaries, and status rendering below the marker.
- Do not execute the wizard end-to-end during development; it opens browsers and requests credentials.

**Stages:**
1. Preflight: clean branch, full tests/contracts, exact `main` SHA, real-domain/policy values.
2. Human accounts: OCI Always Free-only, GCP billing (for free-tier GCS and uptime checks), Cloudflare domain, GitHub repository secrets, MFA.
3. Secret generation: JWT/encryption/Turnstile values entered directly into provider dashboards or VM `.env`; never echoed into wizard state.
4. OCI VM: A1.Flex at exactly 2 OCPU / 12 GB in the home region, capacity/reclamation warning, Docker/OCI CLI/age/gcloud install, clone into an empty target, firewall, persistent volumes. `out of host capacity` stops cutover.
5. Cloudflare: Worker free-plan Git integration from `main`, `BACKEND_API_URL=https://api.<domain>`, Turnstile, DNS proxy, support email route.
6. GCS backup: bucket, least-privilege service account, 30-day lifecycle, AGE recipient only.
7. Monitoring: GCP uptime checks, OCI metric publisher, alarm email subscription and test.
8. Deploy: invoke `ops/deploy-production.sh <main-sha>` and record health output.
9. Soft-launch gate: real-corpus smoke tests, open registration, account deletion, backup/restore drill, 48-hour unannounced observation.

- [ ] Write static contracts for the canonical marker/library, all nine stages, `main`, correct app/API origins, correct preflight path, empty clone target, no stale branch, no free-only 4/24 claim, no UptimeRobot/Grafana requirement, and no plaintext secrets. Confirm RED against the current untracked wizard.
- [ ] Copy the canonical template library and replace only the stages below the marker.
- [ ] Add resumable `is_complete` predicates and read-only `probe` functions for every machine-checkable stage. Human-only confirmations use `prompt_confirm` and explicit consequences.
- [ ] Run `bash -n ops/cutover-wizard.sh` and the focused Pester suite only.

---

## Task 5: Cutover checklist and production documentation

**Files:**
- Modify: `conversion-service/CUTOVER_CHECKLIST.md`
- Modify: `docs/runbook.md`
- Modify: `.scratch/production-readiness/spec.md`
- Modify: `ops/tests/CutoverGate.Tests.ps1`
- Modify: `ops/tests/ProdCompose.Tests.ps1`

- [ ] Change contracts from stale 4-OCPU/24-GB, Cloudflare Pages, UptimeRobot, and Grafana assumptions to OCI Always Free 2-OCPU/12-GB + Cloudflare Worker Free + GCP/OCI monitoring. Confirm RED.
- [ ] Make the checklist require:
  - real domain and working `support@<domain>` route;
  - policies effective on the actual deployment date;
  - Turnstile on open registration;
  - 100-job queue-cap test;
  - independent multi-file partial-failure test;
  - self-service and operator disable/enable/delete exercises;
  - encrypted backup, GCS object, restore drill, and recovery key presence in the password manager;
  - main SHA parity across GitHub, Cloudflare, and OCI;
  - automatic rollback rehearsal without a database restore;
  - both GCP and OCI email alert tests;
  - 48-hour soft-launch observation and real-corpus sign-off.
- [ ] Update the decision spec with implementation evidence and leave final domain/support/deployment date as explicit unresolved gates, not fake production values.
- [ ] Rerun the cutover and production Compose suites.

---

## Task 6: Final verification, review, and deployment handoff

- [ ] Apply `superpowers:verification-before-completion` and run the canonical full verification from a clean process environment.
- [ ] Run backend tests/build, frontend tests/typecheck/lint/Worker build, conversion pytest/compileall/preflight, Compose validation, Pester contracts, `bash -n`, and `git diff --check`.
- [ ] Perform a standards/spec self-review because repository policy does not authorize subagent review. Record findings and fix all high/medium issues with their own RED regression first.
- [ ] Apply `superpowers:finishing-a-development-branch`. Present the user with the verified branch and exact remaining human gates: real domain, actual support mailbox destination, deployment-date value, provider logins/MFA/billing, recovery public key/private-key custody, and final main merge approval.
- [ ] Do not deploy, merge, restore a database, delete a volume, rotate a secret, or enable paid scaling until the relevant gate is explicitly satisfied.
