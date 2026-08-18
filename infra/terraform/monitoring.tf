locals {
  created_notification_channels = var.notification_email == "" ? [] : [google_monitoring_notification_channel.email[0].name]
  notification_channels         = concat(local.created_notification_channels, var.notification_channel_ids)
  operational_failure_signals = {
    unhealthy_readiness = {
      resource_type = "cloud_run_revision"
      filter        = "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"docai-frontend\" log_id(\"run.googleapis.com/requests\") httpRequest.requestUrl=~\"/api/ready$\" httpRequest.status>=500 NOT httpRequest.requestUrl:\"candidate-\""
    }
    worker_failure = {
      resource_type = "cloud_run_revision"
      filter        = "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"docai-backend\" severity>=ERROR jsonPayload.msg:worker"
    }
    failed_job = {
      resource_type = "cloud_run_job"
      filter        = "resource.type=\"cloud_run_job\" severity>=ERROR (resource.labels.job_name=\"docai-migrate\" OR resource.labels.job_name=\"docai-bootstrap-user\" OR resource.labels.job_name=\"docai-reset-password\")"
    }
    failed_deployment = {
      resource_type = "audited_resource"
      filter        = "resource.type=\"audited_resource\" protoPayload.serviceName=\"run.googleapis.com\" severity>=ERROR"
    }
  }
}

resource "google_monitoring_notification_channel" "email" {
  count        = var.notification_email == "" ? 0 : 1
  display_name = "DocAI production operator"
  type         = "email"
  labels = {
    email_address = var.notification_email
  }
  force_delete = false
  depends_on   = [google_project_service.required]
}

resource "google_monitoring_uptime_check_config" "frontend" {
  display_name     = "DocAI frontend HTTPS"
  timeout          = "10s"
  period           = "60s"
  selected_regions = ["ASIA_PACIFIC", "USA", "EUROPE"]
  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = trimprefix(google_cloud_run_v2_service.frontend.uri, "https://")
    }
  }
  http_check {
    path           = "/api/live"
    port           = 443
    use_ssl        = true
    validate_ssl   = true
    request_method = "GET"
  }
}

resource "google_monitoring_alert_policy" "frontend_uptime" {
  display_name          = "DocAI frontend unavailable"
  combiner              = "OR"
  severity              = "ERROR"
  notification_channels = local.notification_channels
  conditions {
    display_name = "Public HTTPS check fails"
    condition_threshold {
      filter          = "resource.type=\"uptime_url\" AND metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.labels.check_id=\"${google_monitoring_uptime_check_config.frontend.uptime_check_id}\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "120s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_NEXT_OLDER"
      }
    }
  }
}

resource "google_monitoring_metric_descriptor" "redis_commands" {
  type         = "custom.googleapis.com/docai/redis_commands"
  metric_kind  = "CUMULATIVE"
  value_type   = "INT64"
  unit         = "1"
  display_name = "DocAI Upstash Redis commands"
  description  = "Command count reported by the production operations collector for free-tier guardrails."
  depends_on   = [google_project_service.required]
}

resource "google_logging_metric" "operational_failures" {
  for_each    = local.operational_failure_signals
  name        = "docai_${each.key}"
  description = "DocAI production signal: ${replace(each.key, "_", " ")}"
  filter      = each.value.filter
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_monitoring_alert_policy" "log_failures" {
  for_each              = local.operational_failure_signals
  display_name          = "DocAI ${title(replace(each.key, "_", " "))}"
  combiner              = "OR"
  severity              = each.key == "unhealthy_readiness" || each.key == "failed_job" ? "ERROR" : "WARNING"
  notification_channels = local.notification_channels
  conditions {
    display_name = "${each.key} events"
    condition_threshold {
      filter          = "resource.type=\"${each.value.resource_type}\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.operational_failures[each.key].name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_DELTA"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
  alert_strategy { auto_close = "1800s" }
}

resource "google_monitoring_alert_policy" "cloud_run_5xx" {
  display_name          = "DocAI Cloud Run 5xx"
  combiner              = "OR"
  severity              = "ERROR"
  notification_channels = local.notification_channels
  conditions {
    display_name = "5xx responses"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND (resource.labels.service_name=\"docai-frontend\" OR resource.labels.service_name=\"docai-backend\") AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code_class=\"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "300s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
}

resource "google_monitoring_alert_policy" "backend_latency" {
  display_name          = "DocAI backend p95 latency"
  combiner              = "OR"
  severity              = "WARNING"
  notification_channels = local.notification_channels
  conditions {
    display_name = "Backend p95 exceeds 5 seconds"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"docai-backend\" AND metric.type=\"run.googleapis.com/request_latencies\""
      comparison      = "COMPARISON_GT"
      threshold_value = 5000
      duration        = "300s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_PERCENTILE_95"
      }
    }
  }
}

resource "google_monitoring_alert_policy" "cloud_run_saturation" {
  display_name          = "DocAI Cloud Run instance saturation"
  combiner              = "OR"
  severity              = "WARNING"
  notification_channels = local.notification_channels
  conditions {
    display_name = "Instance count at personal-pilot ceiling"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"docai-frontend\" AND metric.type=\"run.googleapis.com/container/instance_count\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1.9
      duration        = "300s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MAX"
      }
    }
  }
}

resource "google_monitoring_alert_policy" "sql" {
  for_each = {
    cpu = {
      metric    = "cloudsql.googleapis.com/database/cpu/utilization"
      threshold = 0.8
    }
    storage = {
      metric    = "cloudsql.googleapis.com/database/disk/utilization"
      threshold = 0.8
    }
    connections = {
      metric    = "cloudsql.googleapis.com/database/postgresql/num_backends"
      threshold = 80
    }
  }
  display_name          = "DocAI Cloud SQL ${title(each.key)}"
  combiner              = "OR"
  severity              = "WARNING"
  notification_channels = local.notification_channels
  conditions {
    display_name = "Cloud SQL ${each.key} threshold"
    condition_threshold {
      filter          = "resource.type=\"cloudsql_database\" AND resource.labels.database_id=\"${var.project_id}:${google_sql_database_instance.main.name}\" AND metric.type=\"${each.value.metric}\""
      comparison      = "COMPARISON_GT"
      threshold_value = each.value.threshold
      duration        = "300s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }
}

resource "google_monitoring_dashboard" "release" {
  dashboard_json = jsonencode({
    displayName = "DocAI Production Pilot"
    mosaicLayout = {
      columns = 12
      tiles = [
        {
          width = 6, height = 4
          widget = {
            title   = "Cloud Run request volume"
            xyChart = { dataSets = [{ timeSeriesQuery = { timeSeriesFilter = { filter = "resource.type=\"cloud_run_revision\" metric.type=\"run.googleapis.com/request_count\"", aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_RATE" } } }, plotType = "LINE" }] }
          }
        },
        {
          xPos = 6, width = 6, height = 4
          widget = {
            title   = "Cloud Run p95 latency"
            xyChart = { dataSets = [{ timeSeriesQuery = { timeSeriesFilter = { filter = "resource.type=\"cloud_run_revision\" metric.type=\"run.googleapis.com/request_latencies\"", aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_PERCENTILE_95" } } }, plotType = "LINE" }] }
          }
        },
        {
          yPos = 4, width = 6, height = 4
          widget = {
            title   = "Cloud SQL CPU"
            xyChart = { dataSets = [{ timeSeriesQuery = { timeSeriesFilter = { filter = "resource.type=\"cloudsql_database\" metric.type=\"cloudsql.googleapis.com/database/cpu/utilization\"", aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_MEAN" } } }, plotType = "LINE" }] }
          }
        },
        {
          xPos   = 6, yPos = 4, width = 6, height = 4
          widget = { title = "Release gates", text = { format = "MARKDOWN", content = "Migration and deployment failures, worker health, readiness, Redis allowance, and trial-credit usage are release gates. See the production runbook." } }
        },
        {
          yPos = 8, width = 6, height = 4
          widget = {
            title   = "Upstash Redis command usage"
            xyChart = { dataSets = [{ timeSeriesQuery = { timeSeriesFilter = { filter = "metric.type=\"custom.googleapis.com/docai/redis_commands\"", aggregation = { alignmentPeriod = "3600s", perSeriesAligner = "ALIGN_DELTA" } } }, plotType = "LINE" }] }
          }
        }
      ]
    }
  })
  depends_on = [google_project_service.required]
}
