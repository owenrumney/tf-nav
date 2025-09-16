locals {
  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Owner       = "tf-nav-team"
    CreatedAt   = timestamp()
  }

  all_tags = merge(local.common_tags, var.additional_tags)

  vpc_cidr_parts = split("/", var.vpc_cidr)
  vpc_network    = local.vpc_cidr_parts[0]
  vpc_prefix     = tonumber(local.vpc_cidr_parts[1])
}