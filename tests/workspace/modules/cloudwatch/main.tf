resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${var.project_name}-${var.environment}-dashboard"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6

        properties = {
          metrics = [
            for instance_id in var.instance_ids : [
              "AWS/EC2",
              "CPUUtilization",
              "InstanceId",
              instance_id
            ]
          ]
          view    = "timeSeries"
          stacked = false
          region  = data.aws_region.current.name
          title   = "EC2 CPU Utilization"
          period  = 300
        }
      }
    ]
  })

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "high_cpu" {
  count = length(var.instance_ids)

  alarm_name          = "${var.project_name}-high-cpu-${count.index + 1}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = "300"
  statistic           = "Average"
  threshold           = var.cpu_threshold
  alarm_description   = "This metric monitors ec2 cpu utilization"

  dimensions = {
    InstanceId = var.instance_ids[count.index]
  }

  tags = var.tags
}