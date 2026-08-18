# DocAI production: owner action guide

Last checked: 2026-08-12

This guide contains only the actions that require the project owner's account or access to secret values. Keep `PRODUCTION_ENABLED=false` until every release gate below passes and a separate production apply is explicitly approved.

## Current state

- GitHub repository: `qminhhindahood/DocAI`, private, default branch `master`.
- Google Cloud project: `project-96fe5a5e-a0df-4a2f-902` in `asia-southeast1`.
- Billing, required APIs, remote Terraform state, Artifact Registry, Workload Identity Federation, and the empty Secret Manager containers are configured.
- The LLM encryption key, Redis URL, and Jina API key versions have been added.
- Production is live; this guide now covers the protected public-registration release.
- No SMTP is needed. Email recovery and email verification remain unavailable.

You do not need GitLab, a service-account JSON key, a production `.env` file, or plaintext runtime secrets in GitHub.

## Remaining launch secrets

```text
docai-turnstile-secret-key
```

This is the only additional secret version required for protected public registration. The Cloudflare site key is public deployment configuration and is stored only in the ignored `infra/terraform/prod.tfvars` file.

In Cloudflare, create a **Managed** Turnstile widget named `DocAI production signup`. Restrict it to `docai-frontend-in4iwfyf6q-as.a.run.app`. Copy the site key into `turnstile_site_key` in the ignored production tfvars file. Add the secret key as a new version in the existing `docai-turnstile-secret-key` Secret Manager container. Do not add either value to Git, GitHub Actions, an issue, a screenshot, or logs.

Open [Secret Manager for the DocAI project](https://console.cloud.google.com/security/secret-manager?project=project-96fe5a5e-a0df-4a2f-902). Open each existing container above, choose **Add new version**, and add only its corresponding value. Do not add quotes or leading/trailing spaces. Never paste these values into GitHub, a commit, an issue, a screenshot, or an AI chat.

Verify metadata without revealing payloads:

```powershell
$project = 'project-96fe5a5e-a0df-4a2f-902'
$names = @('docai-turnstile-secret-key')
foreach ($name in $names) {
  gcloud secrets versions list $name `
    --project=$project `
    --format='table(name,state,createTime)'
}
```

Report only the version numbers and states, never their values.

## Public registration safety

Production enables registration with `DISABLE_PUBLIC_REGISTER=false` only when the backend has the Turnstile secret and expected-hostname binding and the frontend has the public site key. Every signup is also limited to five attempts per address per 15 minutes through Redis.

New accounts are usable immediately. Their email is not verified and forgotten passwords cannot be recovered through email. Turnstile limits automated signup but does not impose per-account Cloud Run, database, storage, embeddings, renderer, or Jina spending quotas. Monitor signup volume and GCP costs after enabling it.

To stop new registrations immediately, set `DISABLE_PUBLIC_REGISTER=true` on the backend through a reviewed Terraform change and redeploy. Existing users and sessions remain valid. Backend enforcement is authoritative even if the signup page is still visible during rollback.

## Account recovery without email

After the reset infrastructure has been applied, recover the operator account with:

```powershell
pwsh -NoProfile -File ops/gcp/reset-production-password.ps1 `
  -ProjectId project-96fe5a5e-a0df-4a2f-902 `
  -Region asia-southeast1
```

The command shows the active account and target, requires typing the exact project ID, and prompts twice through secure input. It creates one temporary numeric Secret Manager version in memory, binds it only to the private reset job, waits for the transactional reset, removes the binding, and disables the temporary version. A successful reset changes the password, invalidates unused reset tokens, and invalidates old sessions.

After a reset, sign in again with the new password. Never use the live reset job as a deployment smoke action. Before launch, rehearse the helper only against disposable data in a non-production target.

## What happens next

1. Push the completed registration changes and require every GitHub CI job to pass, including dependency audits, image vulnerability scans, repository contracts, and Terraform validation.
2. Review a fresh Terraform plan for the exact release SHA. Confirm that it contains only approved infrastructure and IAM changes and does not enable traffic.
3. With separate explicit approval, the owner applies Terraform locally. GitHub cannot read Terraform state or mutate IAM.
4. Approve the protected GitHub production environment only after the human apply pins the migration and reset jobs to the release SHA.
5. Run migration, bootstrap, candidate deployment, authenticated production smoke, backup/restore, and rollback gates before traffic promotion.
6. Complete one real Turnstile signup, verify the new account has no access to the operator's private data, and disable the disposable account after validation.

## First login and Gemini

After the production URL is live, sign in, open LLM settings, select Gemini, and store a dedicated Gemini API key and model through the application. The per-user key is encrypted by the backend; it does not belong in GitHub or Terraform.

## Safety rules

- Leave `PRODUCTION_ENABLED=false` until CI and the reviewed no-apply plan are green.
- Never commit `infra/terraform/prod.tfvars`, `.env`, a Terraform plan, or release evidence containing secret data.
- Never create or download a service-account JSON key for this deployment.
- Never expose the backend, Docling, embeddings, renderer, or reset job publicly. Only `docai-frontend` is public.
- A failed scan, migration, readiness check, disabled recovery check, or authenticated smoke test blocks traffic promotion.
- Cloud SQL migrations are forward-only. Rollback changes Cloud Run traffic; it does not rewrite Prisma migration history.
