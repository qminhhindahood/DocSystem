locals {
  external_secret_ids = toset([
    "jwt-secret",
    "llm-config-encryption-key",
    "renderer-internal-token",
    "redis-url",
    "jina-api-key",
    "smtp-user",
    "smtp-pass",
    "admin-reset-password",
    "bootstrap-username",
    "bootstrap-email",
    "bootstrap-password",
    "smoke-username",
    "smoke-password",
    "turnstile-secret-key",
  ])
}

resource "google_secret_manager_secret" "external" {
  for_each  = local.external_secret_ids
  secret_id = "docai-${each.value}"
  labels    = local.labels
  replication {
    auto {}
  }
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret" "database_url" {
  secret_id = "docai-database-url"
  labels    = local.labels
  replication {
    auto {}
  }
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = "postgresql://docai:${urlencode(random_password.database.result)}@localhost/docai?host=/cloudsql/${google_sql_database_instance.main.connection_name}&connection_limit=10"
  depends_on  = [google_sql_database.docai, google_sql_user.docai]
}
