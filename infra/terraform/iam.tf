locals {
  service_accounts = {
    frontend       = "docai-frontend"
    backend        = "docai-backend"
    docling        = "docai-docling"
    embeddings     = "docai-embeddings"
    renderer       = "docai-renderer"
    migration      = "docai-migration"
    password_reset = "docai-password-reset"
    deployer       = "docai-github-deployer"
    smoke          = "docai-smoke"
  }
}

resource "google_service_account" "service" {
  for_each     = local.service_accounts
  account_id   = each.value
  display_name = "DocAI ${title(each.key)}"
  description  = "Least-privilege identity for DocAI ${each.key}"
}

resource "google_project_iam_member" "backend_project_roles" {
  for_each = toset([
    "roles/cloudsql.client",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.service["backend"].email}"
}

resource "google_project_iam_member" "frontend_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.service["frontend"].email}"
}

resource "google_project_iam_member" "migration_cloudsql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.service["migration"].email}"
}

resource "google_storage_bucket_iam_member" "backend_storage" {
  for_each = google_storage_bucket.persistent
  bucket   = each.value.name
  role     = "roles/storage.objectAdmin"
  member   = "serviceAccount:${google_service_account.service["backend"].email}"
}

resource "google_storage_bucket_iam_member" "renderer_templates" {
  bucket = google_storage_bucket.persistent["templates"].name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.service["renderer"].email}"
}

locals {
  backend_secret_ids = toset([
    "jwt-secret",
    "llm-config-encryption-key",
    "renderer-internal-token",
    "redis-url",
    "turnstile-secret-key",
  ])
}

resource "google_secret_manager_secret_iam_member" "backend_external" {
  for_each  = local.backend_secret_ids
  secret_id = google_secret_manager_secret.external[each.value].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.service["backend"].email}"
}

resource "google_secret_manager_secret_iam_member" "backend_database" {
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.service["backend"].email}"
}

resource "google_secret_manager_secret_iam_member" "renderer_token" {
  secret_id = google_secret_manager_secret.external["renderer-internal-token"].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.service["renderer"].email}"
}

resource "google_secret_manager_secret_iam_member" "embeddings_jina" {
  secret_id = google_secret_manager_secret.external["jina-api-key"].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.service["embeddings"].email}"
}

resource "google_secret_manager_secret_iam_member" "migration_database" {
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.service["migration"].email}"
}

resource "google_project_iam_member" "password_reset_project_roles" {
  for_each = toset([
    "roles/cloudsql.client",
    "roles/logging.logWriter",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.service["password_reset"].email}"
}

resource "google_secret_manager_secret_iam_member" "password_reset_database" {
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.service["password_reset"].email}"
}

resource "google_secret_manager_secret_iam_member" "password_reset_external" {
  for_each  = toset(["bootstrap-username", "admin-reset-password"])
  secret_id = google_secret_manager_secret.external[each.value].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.service["password_reset"].email}"
}

resource "google_secret_manager_secret_iam_member" "bootstrap_identity" {
  for_each  = toset(["bootstrap-username", "bootstrap-email", "bootstrap-password", "smoke-username", "smoke-password"])
  secret_id = google_secret_manager_secret.external[each.value].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.service["migration"].email}"
}

resource "google_secret_manager_secret_iam_member" "smoke_credentials" {
  for_each  = toset(["smoke-username", "smoke-password"])
  secret_id = google_secret_manager_secret.external[each.value].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.service["smoke"].email}"
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "docai-github"
  display_name              = "DocAI GitHub Actions"
  description               = "Keyless production deployments from the exact DocAI repository"
  depends_on                = [google_project_service.required]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "docai-github"
  display_name                       = "DocAI GitHub OIDC"
  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
    "attribute.ref_type"   = "assertion.ref_type"
    "attribute.actor"      = "assertion.actor"
  }
  attribute_condition = "attribute.repository == '${var.github_owner}/${var.github_repository}' && attribute.ref == 'refs/heads/${var.production_branch}' && attribute.ref_type == 'branch'"
  oidc { issuer_uri = "https://token.actions.githubusercontent.com" }
}

resource "google_service_account_iam_member" "github_federation" {
  service_account_id = google_service_account.service["deployer"].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_owner}/${var.github_repository}"
}

resource "google_service_account_iam_member" "github_smoke_federation" {
  service_account_id = google_service_account.service["smoke"].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_owner}/${var.github_repository}"
}

resource "google_service_account_iam_member" "smoke_token_creator" {
  service_account_id = google_service_account.service["smoke"].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.service["smoke"].email}"
}

resource "google_artifact_registry_repository_iam_member" "deployer_writer" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.docai.repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.service["deployer"].email}"
}

resource "google_project_iam_custom_role" "cloud_run_deployer" {
  role_id     = "docaiCloudRunDeployer"
  title       = "DocAI Cloud Run Deployer"
  description = "Manage DocAI Cloud Run definitions without IAM-policy mutation or job execution"
  permissions = [
    "resourcemanager.projects.get",
    "run.executions.get",
    "run.executions.list",
    "run.jobs.create",
    "run.jobs.delete",
    "run.jobs.get",
    "run.jobs.getIamPolicy",
    "run.jobs.list",
    "run.jobs.update",
    "run.locations.get",
    "run.locations.list",
    "run.operations.get",
    "run.operations.list",
    "run.revisions.delete",
    "run.revisions.get",
    "run.revisions.list",
    "run.services.create",
    "run.services.delete",
    "run.services.get",
    "run.services.getIamPolicy",
    "run.services.list",
    "run.services.update",
  ]
}

resource "google_project_iam_member" "deployer_cloud_run" {
  project = var.project_id
  role    = google_project_iam_custom_role.cloud_run_deployer.name
  member  = "serviceAccount:${google_service_account.service["deployer"].email}"
}

resource "google_service_account_iam_member" "deployer_service_account_user" {
  for_each           = toset(["frontend", "backend", "docling", "embeddings", "renderer", "migration", "smoke"])
  service_account_id = google_service_account.service[each.value].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.service["deployer"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "frontend_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.frontend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "frontend_invokes_backend" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.backend.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.service["frontend"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "backend_invokes_processing" {
  for_each = {
    docling    = google_cloud_run_v2_service.docling.name
    embeddings = google_cloud_run_v2_service.embeddings.name
    renderer   = google_cloud_run_v2_service.renderer.name
  }
  project  = var.project_id
  location = var.region
  name     = each.value
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.service["backend"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "smoke_invokes_private" {
  for_each = {
    backend    = google_cloud_run_v2_service.backend.name
    docling    = google_cloud_run_v2_service.docling.name
    embeddings = google_cloud_run_v2_service.embeddings.name
    renderer   = google_cloud_run_v2_service.renderer.name
  }
  project  = var.project_id
  location = var.region
  name     = each.value
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.service["smoke"].email}"
}

resource "google_cloud_run_v2_job_iam_member" "deployer_job_invoker" {
  for_each = {
    migrate         = google_cloud_run_v2_job.migrate.name
    bootstrap_smoke = google_cloud_run_v2_job.bootstrap_smoke_user.name
  }
  project  = var.project_id
  location = var.region
  name     = each.value
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.service["deployer"].email}"
}

resource "google_cloud_run_v2_job_iam_member" "operator_reset_developer" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_job.reset_password.name
  role     = "roles/run.developer"
  member   = "user:${var.operator_email}"
}

resource "google_service_account_iam_member" "operator_reset_act_as" {
  service_account_id = google_service_account.service["password_reset"].name
  role               = "roles/iam.serviceAccountUser"
  member             = "user:${var.operator_email}"
}

resource "google_secret_manager_secret_iam_member" "operator_reset_secret_roles" {
  for_each = toset([
    "roles/secretmanager.secretVersionAdder",
    "roles/secretmanager.secretVersionManager",
  ])
  secret_id = google_secret_manager_secret.external["admin-reset-password"].id
  role      = each.value
  member    = "user:${var.operator_email}"
}
