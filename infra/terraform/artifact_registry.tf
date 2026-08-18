resource "google_artifact_registry_repository" "docai" {
  location      = var.region
  repository_id = "docai"
  description   = "Immutable DocAI production container images"
  format        = "DOCKER"
  labels        = local.labels

  depends_on = [google_project_service.required]
}
