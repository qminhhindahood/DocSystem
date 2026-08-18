output "artifact_registry" {
  value = local.registry
}

output "frontend_url" {
  value = google_cloud_run_v2_service.frontend.uri
}

output "backend_url" {
  value = google_cloud_run_v2_service.backend.uri
}

output "processing_urls" {
  value = {
    docling    = google_cloud_run_v2_service.docling.uri
    embeddings = google_cloud_run_v2_service.embeddings.uri
    renderer   = google_cloud_run_v2_service.renderer.uri
  }
}

output "cloud_sql_connection_name" {
  value = google_sql_database_instance.main.connection_name
}

output "github_workload_identity_provider" {
  value = google_iam_workload_identity_pool_provider.github.name
}

output "github_deployer_service_account" {
  value = google_service_account.service["deployer"].email
}

output "bucket_names" {
  value = { for name, bucket in google_storage_bucket.persistent : name => bucket.name }
}

output "password_reset_job" {
  value = google_cloud_run_v2_job.reset_password.name
}
