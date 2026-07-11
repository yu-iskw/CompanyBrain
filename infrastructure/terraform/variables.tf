variable "project_id" {
  description = "Google Cloud project that hosts CompanyBrain."
  type        = string
}

variable "region" {
  description = "Primary region for Cloud Run, Pub/Sub, and storage."
  type        = string
  default     = "us-central1"
}

variable "image_repository" {
  description = "Artifact Registry repository holding the deployable images (api, mcp-server, worker, plugin-runner)."
  type        = string
}

variable "image_tag" {
  description = "Image tag to deploy."
  type        = string
  default     = "latest"
}
