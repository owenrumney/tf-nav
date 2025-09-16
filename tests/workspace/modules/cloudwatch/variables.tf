variable "project_name" {
  description = "Name of the project"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "dev"
}

variable "instance_ids" {
  description = "List of EC2 instance IDs to monitor"
  type        = list(string)
}

variable "cpu_threshold" {
  description = "CPU utilization threshold for alarms"
  type        = number
  default     = 80
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}