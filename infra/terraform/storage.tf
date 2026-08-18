locals {
  buckets = {
    templates = {
      name              = "docai-templates-${var.project_id}"
      versioning        = true
      noncurrent_days   = 30
      delete_after_days = null
    }
    uploads = {
      name              = "docai-uploads-${var.project_id}"
      versioning        = true
      noncurrent_days   = 30
      delete_after_days = null
    }
    rag-state = {
      name              = "docai-rag-state-${var.project_id}"
      versioning        = false
      noncurrent_days   = null
      delete_after_days = 30
    }
  }
}

resource "google_storage_bucket" "persistent" {
  for_each                    = local.buckets
  name                        = each.value.name
  project                     = var.project_id
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels

  versioning {
    enabled = each.value.versioning
  }

  dynamic "lifecycle_rule" {
    for_each = each.value.noncurrent_days == null ? [] : [each.value.noncurrent_days]
    content {
      action { type = "Delete" }
      condition { days_since_noncurrent_time = lifecycle_rule.value }
    }
  }

  dynamic "lifecycle_rule" {
    for_each = each.value.delete_after_days == null ? [] : [each.value.delete_after_days]
    content {
      action { type = "Delete" }
      condition {
        age            = lifecycle_rule.value
        matches_prefix = ["reports/"]
      }
    }
  }

  depends_on = [google_project_service.required]
}
