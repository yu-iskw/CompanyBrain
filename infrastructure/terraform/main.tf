# CompanyBrain Phase 1 infrastructure (RFC section 10).
#
# Deployables run on Cloud Run with one service account per workload so the
# plugin-runner's blast radius stays isolated from the API. Source-system
# change events flow through Pub/Sub into the worker; audit events stream to
# Cloud Logging (sink to BigQuery is Phase 2).

terraform {
  required_version = ">= 1.7"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  deployables = toset(["api", "mcp-server", "worker", "plugin-runner"])
}

# One least-privilege service account per Cloud Run workload.
resource "google_service_account" "workload" {
  for_each     = local.deployables
  account_id   = "companybrain-${each.key}"
  display_name = "CompanyBrain ${each.key}"
}

resource "google_cloud_run_v2_service" "workload" {
  for_each = local.deployables
  name     = "companybrain-${each.key}"
  location = var.region

  # Only the fronting API gateway (OAuth/OIDC) may reach the services.
  ingress = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  template {
    service_account = google_service_account.workload[each.key].email

    containers {
      image = "${var.image_repository}/${each.key}:${var.image_tag}"

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }
}

# Source-system webhook events fan in here; the worker subscribes.
resource "google_pubsub_topic" "source_events" {
  name = "companybrain-source-events"
}

resource "google_pubsub_subscription" "worker" {
  name  = "companybrain-worker"
  topic = google_pubsub_topic.source_events.id

  ack_deadline_seconds = 60

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.source_events_dlq.id
    max_delivery_attempts = 5
  }
}

resource "google_pubsub_topic" "source_events_dlq" {
  name = "companybrain-source-events-dlq"
}

# Crawl snapshots and index artifacts.
resource "google_storage_bucket" "index_artifacts" {
  name     = "${var.project_id}-companybrain-index"
  location = var.region

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }
}

# Source-system credentials live in Secret Manager; plugins only ever see
# scope-narrowed references issued by the credential broker.
resource "google_secret_manager_secret" "source_credentials" {
  for_each  = toset(["github", "google-workspace", "slack", "notion", "bigquery"])
  secret_id = "companybrain-source-${each.key}"

  replication {
    auto {}
  }
}

# Immutable audit trail: route audit log entries to a dedicated bucket with a
# locked retention policy.
resource "google_logging_project_bucket_config" "audit" {
  project        = var.project_id
  location       = "global"
  bucket_id      = "companybrain-audit"
  retention_days = 365
}

resource "google_logging_project_sink" "audit" {
  name        = "companybrain-audit-sink"
  destination = "logging.googleapis.com/projects/${var.project_id}/locations/global/buckets/${google_logging_project_bucket_config.audit.bucket_id}"
  filter      = "jsonPayload.component=\"audit\""
}
