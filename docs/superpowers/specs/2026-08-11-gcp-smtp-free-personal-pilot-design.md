# SMTP-Free GCP Personal Pilot Design

**Date:** 2026-08-11

**Status:** Draft for final review

## Goal

Launch the existing DocAI Google Cloud personal production pilot for one operator without requiring a domain, mailbox, or SMTP provider. The pilot keeps password-based login and private account bootstrap, disables email-based password recovery, and provides a tightly controlled Cloud Run job for emergency operator password resets.

This design preserves the implemented and verified GCP architecture. It does not move the frontend to Vercel, the database to Supabase, or the application to GitHub Pages. Those changes would not host Docling or the continuously polling backend and would add a database, authentication, and storage migration before the first launch.

## Relationship to the Original Pilot Design

This document amends `2026-08-09-gcp-personal-production-pilot-design.md` for the single-operator phase. It supersedes only these original requirements:

- Password reset no longer has to send email before the first launch.
- SMTP credentials and a verified sending domain are no longer production deployment prerequisites.
- The first launch supports one operator only, not invited users.
- Emergency password recovery uses an operator-invoked Cloud Run job.

All other original security, availability, cost, backup, private-service, migration, smoke-test, and rollback decisions remain in force.

## Fixed Decisions

- The pilot has exactly one human application account, created by the existing `docai-bootstrap-user` job.
- Public registration remains disabled.
- `PASSWORD_RESET_MODE` is an explicit enum with `disabled` and `email` values. GCP sets it to `disabled` for this pilot; production never relies on an implicit default.
- SMTP variables and SMTP secret versions are not injected into the backend when reset mode is disabled.
- The login page does not offer a forgot-password link in disabled mode. Direct forgot-password and token-reset requests fail without creating database tokens or contacting a mail server.
- Emergency recovery is implemented by a separate `docai-reset-password` Cloud Run job. The bootstrap job never gains an overwrite or reset mode.
- The reset job targets the configured bootstrap username only. It cannot select arbitrary users from a request or command-line argument.
- The new password is supplied through a temporary Secret Manager version, never through a shell argument, Terraform variable, GitHub secret, log, or committed file.
- A successful reset increments `sessionVersion` and invalidates unused password-reset tokens so existing sessions and old email-reset links cannot survive the reset.
- The SMTP secret containers may remain empty for a future email phase, but neither deployment nor runtime IAM depends on them.

## Alternatives Considered

### Keep GCP and Disable Email Recovery — Selected

This changes only authentication configuration, the password-recovery surface, and one operational job. It retains the green CI pipeline, hardened images, Workload Identity Federation, Cloud Run service isolation, Cloud SQL migration strategy, storage buckets, and Upstash Redis configuration.

### Vercel, Supabase, and GitHub Hybrid — Rejected for First Launch

Vercel could host the Next.js frontend and Supabase could host PostgreSQL with pgvector, but Cloud Run or another container platform would still be required for the polling backend, multi-gigabyte Docling image, LibreOffice renderer, and embeddings proxy. Supabase Auth would require replacing the current JWT and Prisma authentication flows, and its default email provider is not a production substitute for SMTP. This option increases the number of platforms and migration steps without solving the immediate launch blocker.

### Single Docker VM — Rejected for First Launch

A VM could run the Compose stack, but it would replace the completed managed-service work with manual patching, TLS, firewall, backup, disk, process supervision, and recovery responsibilities. It is not the lowest-risk route from the current repository state.

## Runtime Configuration

The backend receives `PASSWORD_RESET_MODE=disabled` from Terraform. Environment validation applies these rules:

- The mode is required and must be exactly `disabled` or `email` in production.
- `email` mode preserves the existing validation for `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USER`, `SMTP_PASS`, and `PASSWORD_RESET_BASE_URL`.
- `disabled` mode does not require those variables. Terraform does not mount `docai-smtp-user` or `docai-smtp-pass`, and the backend service account does not receive access to them.
- Partially configured SMTP credentials remain invalid in email mode.

Terraform removes SMTP values from the initial production plan inputs and removes SMTP entries from the required `secret_versions` map. Existing empty Secret Manager containers are retained only to make a future email phase non-destructive.

Terraform injects the same `PASSWORD_RESET_MODE` value into the frontend server. Server-rendered authentication pages and BFF routes read that runtime value; it is not a client-provided decision. In disabled mode the login page hides the forgot-password link. Direct visits to `/forgot-password` and `/reset-password` show a localized personal-pilot message and a link back to login; they do not render active submission forms.

## HTTP Behavior

The backend checks `PASSWORD_RESET_MODE` before validating an email, looking up a user, creating a token, hashing a token, or invoking the mailer.

When disabled:

- `POST /api/auth/forgot-password` returns `503` with a stable feature-unavailable error code.
- `POST /api/auth/reset-password` returns the same `503` classification.
- No `PasswordResetToken` row is created or modified.
- No account existence information is returned.
- No SMTP connection is attempted.

The frontend BFF preserves that classification and displays a nontechnical message explaining that email recovery is unavailable in the personal pilot. Login, logout, authenticated session lookup, and public-registration denial are unchanged.

## Administrative Reset Job

### Components

- `backend/src/scripts/reset_operator_password.ts`: a one-purpose executable included in the existing backend image.
- `docai-reset-password`: a private Cloud Run job with no schedule and no deployment-workflow execution step.
- `docai-password-reset`: a dedicated runtime service account.
- `docai-admin-reset-password`: a Secret Manager container whose versions exist only during a recovery operation.
- `ops/reset-production-password.ps1`: an interactive owner helper that accepts no plaintext password argument.

The runtime service account receives only Cloud SQL Client, log writer, access to the generated database URL secret, read access to `docai-bootstrap-username`, and read access to `docai-admin-reset-password`. It receives no bucket access, service invocation rights, deployment rights, or access to JWT, Redis, Jina, renderer, LLM encryption, SMTP, bootstrap email, or bootstrap password secrets.

### Job Logic

The job reads `RESET_USERNAME` from the existing bootstrap-username secret and `RESET_PASSWORD` from the temporary reset secret binding. It normalizes and validates the username and password using shared application validation, locates exactly one user by canonical username, and refuses to continue if the account is absent, ambiguous, or disabled.

Within one database transaction the job:

1. Hashes the new password with the existing bcrypt cost.
2. Updates the matching user's `passwordHash`.
3. Increments `sessionVersion` to invalidate existing JWT sessions.
4. Marks every unused password-reset token for that user as used.

The job logs only a safe result code, Cloud Run execution metadata, and the internal user ID. It never logs the username, email, password, password hash, database URL, or secret version payload.

### Operator Recovery Flow

The PowerShell helper performs the recovery in this order:

1. Confirms the exact GCP project, region, job name, and authenticated human principal.
2. Prompts for the new password twice using a non-echoing secure prompt.
3. Rejects an empty, mismatched, or application-invalid password before cloud mutation.
4. Streams the password directly to a new `docai-admin-reset-password` secret version without writing it to disk or placing it in shell history.
5. Temporarily binds that exact numeric secret version to `RESET_PASSWORD` on `docai-reset-password`.
6. Executes the job synchronously and requires a successful terminal state.
7. Removes the temporary secret binding from the job.
8. Disables the temporary secret version whether execution succeeds or fails.
9. Prints metadata-only verification and instructs the operator to test a new login.

Cleanup runs in a `finally` path. A failure to clean up is reported as a separate high-priority error with exact metadata-only manual cleanup commands. The helper never automatically enables production traffic or changes unrelated infrastructure.

## Invocation Authorization

The human Google account configured as the production operator receives resource-scoped permission to update and invoke only `docai-reset-password`, plus version-adder and version-manager permissions only on `docai-admin-reset-password`.

The GitHub deployment identity does not read Terraform state and does not run Terraform plan or apply. It has no predefined project role, billing access, project IAM administration, custom-role administration, Secret Manager IAM management, or permission to act as the password-reset service account. Its broad roles are replaced with writer access scoped to the `docai` Artifact Registry repository, a custom Cloud Run deployment role without IAM-policy mutation or job execution, and job-level invocation only for migration and deployment smoke.

Infrastructure and IAM planning/apply are human operations performed with the authenticated operator account. After immutable images are published, the protected GitHub production environment pauses. The operator reviews and applies Terraform locally with the exact release SHA, then approves the deployment. GitHub verifies that both the migration and reset job definitions are pinned to that SHA before it executes migration or changes application revisions.

No public principal, frontend identity, backend identity, smoke identity, or processing-service identity can invoke the reset job. The deployment workflow contains no reset-job execution command.

## Deployment and Bootstrap

The initial deployment requires enabled versions for:

- `docai-llm-config-encryption-key`
- `docai-redis-url`
- `docai-jina-api-key`
- `docai-bootstrap-username`
- `docai-bootstrap-email`
- `docai-bootstrap-password`

The bootstrap email may be the operator's personal email address. It is an account identifier and is not used as an outbound sender while password-reset mode is disabled.

The deployment order is immutable image publication, protected-environment pause, human Terraform plan/apply, GitHub job-image preflight, migration, smoke bootstrap, private processing services, no-traffic backend/frontend candidates, authenticated smoke tests, and traffic promotion. The operator bootstrap job is executed once through the documented owner step. After verified login, the initial bootstrap-password version is disabled as before.

The production smoke gate substitutes these checks for the original email reset check:

- Forgot-password UI is absent.
- Direct forgot/reset API calls return the disabled-mode classification.
- No reset-token row is created by the disabled request.
- Normal operator login succeeds.
- A disposable-database rehearsal of the administrative reset job changes the password, increments `sessionVersion`, invalidates old sessions, and leaves no enabled temporary reset secret.

The live production reset job is not executed merely to prove deployment. Its behavior is rehearsed against disposable data before launch; production execution is reserved for an actual recovery event.

## Failure Behavior

- Missing or invalid `PASSWORD_RESET_MODE` prevents the production backend from starting.
- Disabled HTTP recovery fails before any database or mail side effect.
- Missing reset secret input causes the administrative job to fail before querying or updating a user.
- Missing, ambiguous, or disabled operator identity causes a nonzero job exit with no database mutation.
- Password validation or hashing failure causes no database mutation.
- Transaction failure rolls back the password, session version, and token changes together.
- Job failure still triggers helper cleanup of the secret binding and temporary secret version.
- Cleanup failure never gets reported as a successful reset, even when the database update completed.
- A failed administrative reset emits an alert through the existing Cloud Run job-failure monitoring path without including credentials.

## Testing Strategy

Implementation follows red-green TDD and adds coverage at each boundary:

### Backend

- Environment validation accepts disabled production mode without SMTP and rejects unknown or implicit production modes.
- Email mode continues to require paired SMTP credentials and an HTTPS reset origin.
- Disabled forgot/reset routes return the stable unavailable classification.
- Disabled requests perform no user lookup, token mutation, hashing, or mail call.
- The reset script accepts the exact bootstrap operator, uses the shared bcrypt function, increments `sessionVersion`, and invalidates open reset tokens in one transaction.
- The reset script rejects absent, ambiguous, disabled, or noncanonical users and redacts all credential material.

### Frontend

- Login hides the forgot-password link when disabled.
- Direct recovery pages show the pilot-unavailable state rather than forms.
- The BFF preserves the backend disabled classification and does not fabricate a sent-email success message.

### Infrastructure and Workflow

- Rendered Terraform has no SMTP secret references on the backend in disabled mode.
- The reset service account has only the documented project and secret permissions.
- The reset job is private, unscheduled, single-attempt, and absent from deployment execution steps.
- The GitHub deployer cannot read Terraform state, mutate IAM, act as the reset identity, or execute the reset job; it retains invocation only on required deployment jobs.
- Production planning no longer requires an SMTP sender variable or SMTP secret versions.

### Operational Rehearsal

- The helper is tested against a disposable GCP job and secret, including mismatched prompt, job failure, and cleanup failure paths.
- A disposable database confirms old-password rejection, new-password acceptance, old-session rejection, and reset-token invalidation.
- Secret-version metadata confirms that the temporary version is disabled after both successful and failed rehearsals.

The existing full repository verifier, container vulnerability scans, migration rehearsal, Terraform plan contracts, secret scan, and whitespace checks remain mandatory.

## Rollout and Rollback

The feature ships with `PASSWORD_RESET_MODE=disabled` before any production apply. Terraform plan review must show removal of backend SMTP references and addition of the private reset job, service account, secret container, scoped IAM, and monitoring coverage. Production remains gated by `PRODUCTION_ENABLED=false` until the amended plan and required bootstrap secret versions are reviewed.

Application rollback restores the prior backend/frontend images only if their environment contract is compatible. Infrastructure rollback must not reintroduce SMTP secret references without enabled versions. If the reset-job rollout fails, the job and its dedicated IAM may be removed without affecting normal login or bootstrap.

## Restoring Email Later

Email recovery is a separate future change. Re-enabling it requires a verified sender, authenticated provider configuration, enabled SMTP secret versions, updated Terraform plan inputs, `PASSWORD_RESET_MODE=email`, restored frontend recovery UI, delivery tests, and an amended production smoke check. The administrative reset job remains a break-glass mechanism unless a later reviewed design removes it.

## Success Criteria

The SMTP-free personal pilot is ready when all of the following are true:

1. The repository verifier and GitHub CI pass with disabled-mode, reset-job, IAM, and Terraform contracts.
2. Production backend and frontend candidates start without SMTP secret versions.
3. Public registration and email password recovery are visibly disabled.
4. Forgot/reset requests create no token and reveal no account information.
5. The single bootstrap operator can log in normally.
6. A disposable rehearsal proves the administrative reset transaction and cleanup behavior.
7. Only the configured human operator can plan/apply reset infrastructure or invoke the reset job; GitHub automation cannot read Terraform state, mutate its IAM, act as its identity, or execute it.
8. Temporary reset password material never enters Git, GitHub, Terraform state, command history, files, or logs.
9. Production traffic remains disabled until the amended Terraform plan, bootstrap secrets, migration, smoke checks, and recovery rehearsal pass.

## Non-Goals

- Public registration or invitations.
- Multiple human accounts in the first production pilot.
- Email verification, email notifications, magic links, or outbound campaigns.
- Supabase Auth or database migration.
- Vercel or GitHub Pages hosting migration.
- An in-application administrator password-reset screen.
- Automatic or scheduled password changes.
