resource "random_password" "database" {
  length           = 40
  special          = true
  override_special = "-._~"
}

resource "google_sql_database_instance" "main" {
  name                = "docai-postgres"
  project             = var.project_id
  region              = var.region
  database_version    = "POSTGRES_15"
  deletion_protection = true

  settings {
    tier                        = "db-g1-small"
    availability_type           = "ZONAL"
    disk_type                   = "PD_SSD"
    disk_size                   = 10
    disk_autoresize             = false
    deletion_protection_enabled = true
    user_labels                 = local.labels

    backup_configuration {
      enabled                        = true
      start_time                     = "18:00"
      location                       = var.region
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 7
        retention_unit   = "COUNT"
      }
    }

    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_sql_database" "docai" {
  name     = "docai"
  instance = google_sql_database_instance.main.name
}

resource "google_sql_user" "docai" {
  name     = "docai"
  instance = google_sql_database_instance.main.name
  password = random_password.database.result
}
