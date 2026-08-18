resource "google_cloud_run_v2_service" "docling" {
  provider            = google-beta
  name                = "docai-docling"
  location            = var.region
  deletion_protection = true
  ingress             = "INGRESS_TRAFFIC_ALL"
  labels              = local.labels

  template {
    service_account                  = google_service_account.service["docling"].email
    timeout                          = "900s"
    max_instance_request_concurrency = 1
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
    containers {
      name  = "docling"
      image = "${local.registry}/docling:${var.image_tag}"
      ports { container_port = 8001 }
      resources {
        limits            = { cpu = "2", memory = "4Gi" }
        cpu_idle          = true
        startup_cpu_boost = true
      }
      startup_probe {
        initial_delay_seconds = 0
        timeout_seconds       = 5
        period_seconds        = 10
        failure_threshold     = 24
        http_get {
          path = "/live"
          port = 8001
        }
      }
      liveness_probe {
        timeout_seconds   = 5
        period_seconds    = 30
        failure_threshold = 3
        http_get {
          path = "/live"
          port = 8001
        }
      }
    }
  }
  depends_on = [google_artifact_registry_repository.docai]
  lifecycle { ignore_changes = [template[0].containers[0].image, traffic] }
}

resource "google_cloud_run_v2_service" "embeddings" {
  provider            = google-beta
  name                = "docai-embeddings"
  location            = var.region
  deletion_protection = true
  ingress             = "INGRESS_TRAFFIC_ALL"
  labels              = local.labels

  template {
    service_account                  = google_service_account.service["embeddings"].email
    timeout                          = "180s"
    max_instance_request_concurrency = 10
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
    containers {
      name  = "embeddings"
      image = "${local.registry}/embeddings:${var.image_tag}"
      ports { container_port = 8002 }
      env {
        name = "JINA_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.external["jina-api-key"].secret_id
            version = var.secret_versions["jina-api-key"]
          }
        }
      }
      resources {
        limits            = { cpu = "2", memory = "4Gi" }
        cpu_idle          = true
        startup_cpu_boost = true
      }
      startup_probe {
        timeout_seconds   = 5
        period_seconds    = 10
        failure_threshold = 12
        http_get {
          path = "/live"
          port = 8002
        }
      }
      liveness_probe {
        timeout_seconds   = 5
        period_seconds    = 30
        failure_threshold = 3
        http_get {
          path = "/live"
          port = 8002
        }
      }
    }
  }
  depends_on = [google_secret_manager_secret_iam_member.embeddings_jina]
  lifecycle { ignore_changes = [template[0].containers[0].image, traffic] }
}

resource "google_cloud_run_v2_service" "renderer" {
  provider            = google-beta
  name                = "docai-renderer"
  location            = var.region
  deletion_protection = true
  ingress             = "INGRESS_TRAFFIC_ALL"
  labels              = local.labels

  template {
    service_account                  = google_service_account.service["renderer"].email
    timeout                          = "300s"
    max_instance_request_concurrency = 1
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
    volumes {
      name = "templates"
      gcs {
        bucket        = google_storage_bucket.persistent["templates"].name
        read_only     = false
        mount_options = ["uid=1654", "gid=1654", "implicit-dirs"]
      }
    }
    containers {
      name  = "renderer"
      image = "${local.registry}/renderer:${var.image_tag}"
      ports { container_port = 8080 }
      env {
        name  = "RENDERER_STORAGE_ROOT"
        value = "/data/templates"
      }
      env {
        name = "RENDERER_SERVICE_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.external["renderer-internal-token"].secret_id
            version = var.secret_versions["renderer-internal-token"]
          }
        }
      }
      volume_mounts {
        name       = "templates"
        mount_path = "/data/templates"
      }
      resources {
        limits            = { cpu = "1", memory = "3Gi" }
        cpu_idle          = true
        startup_cpu_boost = true
      }
      startup_probe {
        timeout_seconds   = 10
        period_seconds    = 10
        failure_threshold = 24
        http_get {
          path = "/live"
          port = 8080
        }
      }
      liveness_probe {
        timeout_seconds   = 10
        period_seconds    = 30
        failure_threshold = 3
        http_get {
          path = "/live"
          port = 8080
        }
      }
    }
  }
  depends_on = [google_secret_manager_secret_iam_member.renderer_token, google_storage_bucket_iam_member.renderer_templates]
  lifecycle { ignore_changes = [template[0].containers[0].image, traffic] }
}

resource "google_cloud_run_v2_service" "backend" {
  provider            = google-beta
  name                = "docai-backend"
  location            = var.region
  deletion_protection = true
  ingress             = "INGRESS_TRAFFIC_ALL"
  labels              = local.labels

  template {
    service_account                  = google_service_account.service["backend"].email
    timeout                          = "900s"
    max_instance_request_concurrency = 20
    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }
    volumes {
      name = "templates"
      gcs {
        bucket        = google_storage_bucket.persistent["templates"].name
        read_only     = false
        mount_options = ["uid=1000", "gid=1000", "implicit-dirs"]
      }
    }
    volumes {
      name = "uploads"
      gcs {
        bucket        = google_storage_bucket.persistent["uploads"].name
        read_only     = false
        mount_options = ["uid=1000", "gid=1000", "implicit-dirs"]
      }
    }
    volumes {
      name = "rag-state"
      gcs {
        bucket        = google_storage_bucket.persistent["rag-state"].name
        read_only     = false
        mount_options = ["uid=1000", "gid=1000", "implicit-dirs"]
      }
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance { instances = [google_sql_database_instance.main.connection_name] }
    }
    containers {
      name  = "backend"
      image = "${local.registry}/backend:${var.image_tag}"
      ports { container_port = 3001 }
      dynamic "env" {
        for_each = {
          NODE_ENV                     = "production"
          TRUST_PROXY_HOPS             = "1"
          DISABLE_PUBLIC_REGISTER      = "false"
          TURNSTILE_EXPECTED_HOSTNAMES = join(",", [for origin in concat([var.public_frontend_origin], var.public_frontend_fallback_origins) : trimsuffix(trimprefix(origin, "https://"), "/")])
          DB_CONNECTION_LIMIT          = "10"
          DOCLING_ASYNC_TIMEOUT_MS     = "840000"
          DOCLING_URL                  = google_cloud_run_v2_service.docling.uri
          EMBEDDINGS_URL               = google_cloud_run_v2_service.embeddings.uri
          DOCUMENT_RENDERER_URL        = google_cloud_run_v2_service.renderer.uri
          CORS_ORIGIN                  = join(",", concat([var.public_frontend_origin], var.public_frontend_fallback_origins))
          PASSWORD_RESET_MODE          = "disabled"
          UPLOAD_DIR                   = "/data/uploads"
          TEMPLATE_STORAGE_DIR         = "/data/templates"
          RAG_STATE_DIR                = "/data/rag-state"
          RAG_RESULTS_DIR              = "/data/rag-state/reports"
          REINDEX_MANIFEST_PATH        = "/data/rag-state/manifests/reindex.json"
        }
        content {
          name  = env.key
          value = env.value
        }
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = google_secret_manager_secret_version.database_url.version
          }
        }
      }
      env {
        name = "JWT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.external["jwt-secret"].secret_id
            version = var.secret_versions["jwt-secret"]
          }
        }
      }
      env {
        name = "LLM_CONFIG_ENCRYPTION_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.external["llm-config-encryption-key"].secret_id
            version = var.secret_versions["llm-config-encryption-key"]
          }
        }
      }
      env {
        name = "RENDERER_INTERNAL_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.external["renderer-internal-token"].secret_id
            version = var.secret_versions["renderer-internal-token"]
          }
        }
      }
      env {
        name = "REDIS_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.external["redis-url"].secret_id
            version = var.secret_versions["redis-url"]
          }
        }
      }
      env {
        name = "TURNSTILE_SECRET_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.external["turnstile-secret-key"].secret_id
            version = var.secret_versions["turnstile-secret-key"]
          }
        }
      }
      volume_mounts {
        name       = "templates"
        mount_path = "/data/templates"
      }
      volume_mounts {
        name       = "uploads"
        mount_path = "/data/uploads"
      }
      volume_mounts {
        name       = "rag-state"
        mount_path = "/data/rag-state"
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
      resources {
        limits            = { cpu = "1", memory = "2Gi" }
        cpu_idle          = false
        startup_cpu_boost = true
      }
      startup_probe {
        initial_delay_seconds = 5
        timeout_seconds       = 5
        period_seconds        = 10
        failure_threshold     = 24
        http_get {
          path = "/live"
          port = 3001
        }
      }
      liveness_probe {
        timeout_seconds   = 5
        period_seconds    = 30
        failure_threshold = 3
        http_get {
          path = "/live"
          port = 3001
        }
      }
    }
  }
  depends_on = [
    google_secret_manager_secret_iam_member.backend_database,
    google_secret_manager_secret_iam_member.backend_external,
    google_storage_bucket_iam_member.backend_storage,
    google_project_iam_member.backend_project_roles,
  ]
  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      traffic,
      client,
      client_version,
    ]
  }
}

resource "google_cloud_run_v2_service" "frontend" {
  provider            = google-beta
  name                = "docai-frontend"
  location            = var.region
  deletion_protection = true
  ingress             = "INGRESS_TRAFFIC_ALL"
  labels              = local.labels

  template {
    service_account = google_service_account.service["frontend"].email
    # This service hosts the streaming BFF. Its request must remain open for
    # the backend's full document-generation deadline.
    timeout                          = "900s"
    max_instance_request_concurrency = 40
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }
    containers {
      name  = "frontend"
      image = "${local.registry}/frontend:${var.image_tag}"
      ports { container_port = 3000 }
      dynamic "env" {
        for_each = {
          NODE_ENV                  = "production"
          BACKEND_API_URL           = google_cloud_run_v2_service.backend.uri
          FRONTEND_TRUST_PROXY_HOPS = "1"
          PASSWORD_RESET_MODE       = "disabled"
          TURNSTILE_SITE_KEY        = var.turnstile_site_key
        }
        content {
          name  = env.key
          value = env.value
        }
      }
      resources {
        limits            = { cpu = "1", memory = "512Mi" }
        cpu_idle          = true
        startup_cpu_boost = true
      }
      startup_probe {
        timeout_seconds   = 5
        period_seconds    = 10
        failure_threshold = 12
        http_get {
          path = "/api/live"
          port = 3000
        }
      }
      liveness_probe {
        timeout_seconds   = 5
        period_seconds    = 30
        failure_threshold = 3
        http_get {
          path = "/api/live"
          port = 3000
        }
      }
    }
  }
  depends_on = [google_project_iam_member.frontend_log_writer]
  lifecycle { ignore_changes = [template[0].containers[0].image, traffic] }
}

resource "google_cloud_run_v2_job" "migrate" {
  provider            = google-beta
  name                = "docai-migrate"
  location            = var.region
  deletion_protection = true
  labels              = local.labels
  template {
    template {
      service_account = google_service_account.service["migration"].email
      timeout         = "900s"
      max_retries     = 0
      volumes {
        name = "cloudsql"
        cloud_sql_instance { instances = [google_sql_database_instance.main.connection_name] }
      }
      containers {
        name    = "migrate"
        image   = "${local.registry}/backend:${var.image_tag}"
        command = ["sh"]
        args = [
          "-ec",
          replace(<<-EOT
            export PATH=/app/node_modules/.bin:$PATH
            node dist/scripts/prepare_database.js
            node node_modules/prisma/build/index.js migrate deploy
            node - <<'NODE'
            const { Client } = require("pg");
            const systemOwnerId = "00000000-0000-0000-0000-000000000001";
            const stripTextDefault = (row) => row.val ? row.val.replace(/::text$/, "").replace(/'/g, "").trim() : null;
            const stripStatusDefault = (row) => row.val ? row.val.replace(/::"TemplateStatus"$/, "").replace(/'/g, "").trim() : null;
            const assertions = [
              { name: "No Document rows with NULL ownerId", sql: 'SELECT COUNT(*) AS cnt FROM "Document" WHERE "ownerId" IS NULL', expected: "0", transform: (row) => row.cnt },
              { name: "No Template rows with NULL ownerId", sql: 'SELECT COUNT(*) AS cnt FROM "Template" WHERE "ownerId" IS NULL', expected: "0", transform: (row) => row.cnt },
              { name: "System-owner user exists and is disabled", sql: 'SELECT COUNT(*) AS cnt FROM "User" WHERE "id" = $1 AND "isDisabled" = true', values: [systemOwnerId], expected: "1", transform: (row) => row.cnt },
              { name: "Document.ownerId has system-owner default", sql: "SELECT column_default AS val FROM information_schema.columns WHERE table_name = 'Document' AND column_name = 'ownerId'", expected: systemOwnerId, transform: stripTextDefault },
              { name: "Template.ownerId has system-owner default", sql: "SELECT column_default AS val FROM information_schema.columns WHERE table_name = 'Template' AND column_name = 'ownerId'", expected: systemOwnerId, transform: stripTextDefault },
              { name: "Template.status has REJECTED default", sql: "SELECT column_default AS val FROM information_schema.columns WHERE table_name = 'Template' AND column_name = 'status'", expected: "REJECTED", transform: stripStatusDefault },
            ];
            (async () => {
              const client = new Client({ connectionString: process.env.DATABASE_URL });
              const failures = [];
              try {
                await client.connect();
                for (const assertion of assertions) {
                  const result = await client.query(assertion.sql, assertion.values || []);
                  const actual = result.rows[0] ? assertion.transform(result.rows[0]) : null;
                  if (actual !== assertion.expected) failures.push(assertion.name);
                  else console.log("  PASS  " + assertion.name);
                }
              } finally {
                await client.end().catch(() => undefined);
              }
              if (failures.length) throw new Error("Owner integrity failed: " + failures.join(", "));
              console.log("Owner integrity verified");
            })().catch((error) => {
              console.error(error instanceof Error ? error.message : String(error));
              process.exit(1);
            });
            NODE
          EOT
          , "\r", "")
        ]
        env {
          name  = "NODE_ENV"
          value = "production"
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url.secret_id
              version = google_secret_manager_secret_version.database_url.version
            }
          }
        }
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
        resources { limits = { cpu = "1", memory = "1Gi" } }
      }
    }
  }
  depends_on = [google_secret_manager_secret_iam_member.migration_database]
  lifecycle { ignore_changes = [client, client_version] }
}

resource "google_cloud_run_v2_job" "bootstrap_user" {
  provider            = google-beta
  name                = "docai-bootstrap-user"
  location            = var.region
  deletion_protection = true
  labels              = local.labels
  template {
    template {
      service_account = google_service_account.service["migration"].email
      timeout         = "300s"
      max_retries     = 0
      volumes {
        name = "cloudsql"
        cloud_sql_instance { instances = [google_sql_database_instance.main.connection_name] }
      }
      containers {
        name    = "bootstrap-user"
        image   = "${local.registry}/backend:${var.image_tag}"
        command = ["node"]
        args    = ["dist/scripts/bootstrap_user.js"]
        env {
          name  = "NODE_ENV"
          value = "production"
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url.secret_id
              version = google_secret_manager_secret_version.database_url.version
            }
          }
        }
        dynamic "env" {
          for_each = {
            BOOTSTRAP_USERNAME = "bootstrap-username"
            BOOTSTRAP_EMAIL    = "bootstrap-email"
            BOOTSTRAP_PASSWORD = "bootstrap-password"
          }
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.external[env.value].secret_id
                version = var.secret_versions[env.value]
              }
            }
          }
        }
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
        resources { limits = { cpu = "1", memory = "1Gi" } }
      }
    }
  }
  depends_on = [google_secret_manager_secret_iam_member.migration_database, google_secret_manager_secret_iam_member.bootstrap_identity]
}

resource "google_cloud_run_v2_job" "bootstrap_smoke_user" {
  provider            = google-beta
  name                = "docai-bootstrap-smoke-user"
  location            = var.region
  deletion_protection = true
  labels              = local.labels
  template {
    template {
      service_account = google_service_account.service["migration"].email
      timeout         = "300s"
      max_retries     = 0
      volumes {
        name = "cloudsql"
        cloud_sql_instance { instances = [google_sql_database_instance.main.connection_name] }
      }
      containers {
        name    = "bootstrap-smoke-user"
        image   = "${local.registry}/backend:${var.image_tag}"
        command = ["node"]
        args    = ["dist/scripts/bootstrap_user.js"]
        env {
          name  = "NODE_ENV"
          value = "production"
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url.secret_id
              version = google_secret_manager_secret_version.database_url.version
            }
          }
        }
        env {
          name = "BOOTSTRAP_USERNAME"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.external["smoke-username"].secret_id
              version = var.secret_versions["smoke-username"]
            }
          }
        }
        env {
          name  = "BOOTSTRAP_EMAIL"
          value = "smoke@docai.invalid"
        }
        env {
          name = "BOOTSTRAP_PASSWORD"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.external["smoke-password"].secret_id
              version = var.secret_versions["smoke-password"]
            }
          }
        }
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
        resources { limits = { cpu = "1", memory = "1Gi" } }
      }
    }
  }
  depends_on = [google_secret_manager_secret_iam_member.migration_database, google_secret_manager_secret_iam_member.bootstrap_identity]
}

resource "google_cloud_run_v2_job" "reset_password" {
  provider            = google-beta
  name                = "docai-reset-password"
  location            = var.region
  deletion_protection = true
  labels              = local.labels
  template {
    template {
      service_account = google_service_account.service["password_reset"].email
      timeout         = "300s"
      max_retries     = 0
      volumes {
        name = "cloudsql"
        cloud_sql_instance { instances = [google_sql_database_instance.main.connection_name] }
      }
      containers {
        name    = "reset-password"
        image   = "${local.registry}/backend:${var.image_tag}"
        command = ["node"]
        args    = ["dist/scripts/reset_operator_password.js"]
        env {
          name  = "NODE_ENV"
          value = "production"
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url.secret_id
              version = google_secret_manager_secret_version.database_url.version
            }
          }
        }
        env {
          name = "RESET_USERNAME"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.external["bootstrap-username"].secret_id
              version = var.secret_versions["bootstrap-username"]
            }
          }
        }
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
        resources { limits = { cpu = "1", memory = "1Gi" } }
      }
    }
  }
  depends_on = [
    google_project_iam_member.password_reset_project_roles,
    google_secret_manager_secret_iam_member.password_reset_database,
    google_secret_manager_secret_iam_member.password_reset_external,
  ]
}
