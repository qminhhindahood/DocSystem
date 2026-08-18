resource "google_pubsub_topic" "budget" {
  name                       = "docai-budget-alerts"
  message_retention_duration = "604800s"
  labels                     = local.labels
  depends_on                 = [google_project_service.required]
}

resource "google_billing_budget" "pilot" {
  billing_account = var.billing_account_id
  display_name    = "DocAI production pilot trial guardrail"
  budget_filter {
    projects               = ["projects/${data.google_project.current.number}"]
    credit_types_treatment = "EXCLUDE_ALL_CREDITS"
  }
  amount {
    specified_amount {
      currency_code = "VND"
      units         = "7200000"
    }
  }
  threshold_rules { threshold_percent = 0.181818 }
  threshold_rules { threshold_percent = 0.545455 }
  threshold_rules { threshold_percent = 0.818182 }
  threshold_rules { threshold_percent = 1.0 }
  all_updates_rule {
    pubsub_topic                     = google_pubsub_topic.budget.id
    schema_version                   = "1.0"
    monitoring_notification_channels = local.notification_channels
    disable_default_iam_recipients   = false
  }
}
