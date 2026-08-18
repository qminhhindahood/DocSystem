provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

data "google_project" "current" {
  project_id = var.project_id
}

locals {
  registry     = "${var.region}-docker.pkg.dev/${var.project_id}/docai"
  backend_url  = google_cloud_run_v2_service.backend.uri
  frontend_url = google_cloud_run_v2_service.frontend.uri
  labels = {
    application = "docai"
    environment = "production"
    managed_by  = "terraform"
  }
}
