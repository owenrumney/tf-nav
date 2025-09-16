variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "tf-nav-test"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "availability_zones" {
  description = "List of availability zones"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.micro"
}

variable "instance_count" {
  description = "Number of EC2 instances to create"
  type        = number
  default     = 2
}

variable "key_name" {
  description = "AWS Key Pair name for EC2 instances"
  type        = string
  default     = null
}

variable "database_name" {
  description = "Name of the database"
  type        = string
  default     = "appdb"
}

variable "database_username" {
  description = "Database master username"
  type        = string
  default     = "admin"
  sensitive   = true
}

variable "database_password" {
  description = "Database master password"
  type        = string
  sensitive   = true
  default     = null
}