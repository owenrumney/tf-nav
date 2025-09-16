#!/bin/bash
# User data script for EC2 instances
# This file should NOT be discovered by the Terraform file finder

yum update -y
yum install -y httpd

systemctl start httpd
systemctl enable httpd

echo "<h1>Welcome to ${project_name}</h1>" > /var/www/html/index.html