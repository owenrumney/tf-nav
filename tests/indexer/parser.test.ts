// Tests for Terraform parser functionality
import { HCL2Parser, TerraformParserFactory } from '../../src/indexer/parser';
import { Address, BlockType, ParseResult } from '../../src/types';
import * as path from 'path';

describe('HCL2Parser', () => {
  let parser: HCL2Parser;

  beforeEach(() => {
    parser = new HCL2Parser();
  });

  describe('canParse', () => {
    it('should accept .tf files', () => {
      expect(parser.canParse('/path/to/main.tf')).toBe(true);
    });

    it('should accept .tf.json files', () => {
      expect(parser.canParse('/path/to/main.tf.json')).toBe(true);
    });

    it('should reject other file types', () => {
      expect(parser.canParse('/path/to/main.js')).toBe(false);
      expect(parser.canParse('/path/to/main.py')).toBe(false);
      expect(parser.canParse('/path/to/main.yaml')).toBe(false);
    });
  });

  describe('parseFile', () => {
    const testFilePath = '/test/main.tf';

    it('should parse resource blocks', async () => {
      const content = `
resource "aws_instance" "web" {
  ami           = "ami-12345"
  instance_type = "t3.micro"
  
  tags = {
    Name = "WebServer"
  }
}

resource "aws_security_group" "web_sg" {
  name = "web-security-group"
  
  ingress {
    from_port = 80
    to_port   = 80
    protocol  = "tcp"
  }
}
      `;

      const result = await parser.parseFile(testFilePath, content);

      expect(result.errors).toHaveLength(0);
      expect(result.blocks).toHaveLength(2);

      const webInstance = result.blocks.find(b => b.name === 'web');
      expect(webInstance).toBeDefined();
      expect(webInstance?.blockType).toBe('resource');
      expect(webInstance?.kind).toBe('aws_instance');
      expect(webInstance?.provider).toBe('aws');
      expect(webInstance?.file).toBe(testFilePath);
      expect(webInstance?.modulePath).toEqual([]);

      const securityGroup = result.blocks.find(b => b.name === 'web_sg');
      expect(securityGroup).toBeDefined();
      expect(securityGroup?.blockType).toBe('resource');
      expect(securityGroup?.kind).toBe('aws_security_group');
      expect(securityGroup?.provider).toBe('aws');
    });

    it('should parse data source blocks', async () => {
      const content = `
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-focal-20.04-amd64-server-*"]
  }
}

data "aws_vpc" "default" {
  default = true
}
      `;

      const result = await parser.parseFile(testFilePath, content);

      expect(result.errors).toHaveLength(0);
      expect(result.blocks).toHaveLength(2);

      const ubuntu = result.blocks.find(b => b.name === 'ubuntu');
      expect(ubuntu).toBeDefined();
      expect(ubuntu?.blockType).toBe('data');
      expect(ubuntu?.kind).toBe('aws_ami');
      expect(ubuntu?.provider).toBe('aws');

      const vpc = result.blocks.find(b => b.name === 'default');
      expect(vpc).toBeDefined();
      expect(vpc?.blockType).toBe('data');
      expect(vpc?.kind).toBe('aws_vpc');
    });

    it('should parse module blocks', async () => {
      const content = `
module "vpc" {
  source = "./modules/vpc"
  
  cidr_block = "10.0.0.0/16"
  name       = "main-vpc"
}

module "database" {
  source = "terraform-aws-modules/rds/aws"
  
  identifier = "myapp-db"
  engine     = "postgres"
}
      `;

      const result = await parser.parseFile(testFilePath, content);

      expect(result.errors).toHaveLength(0);
      expect(result.blocks).toHaveLength(2);

      const vpc = result.blocks.find(b => b.name === 'vpc');
      expect(vpc).toBeDefined();
      expect(vpc?.blockType).toBe('module');
      expect(vpc?.name).toBe('vpc');

      const database = result.blocks.find(b => b.name === 'database');
      expect(database).toBeDefined();
      expect(database?.blockType).toBe('module');
      expect(database?.name).toBe('database');
    });

    it('should parse variable blocks', async () => {
      const content = `
variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "instance_count" {
  description = "Number of instances"
  type        = number
  default     = 1
  
  validation {
    condition     = var.instance_count > 0
    error_message = "Instance count must be positive."
  }
}
      `;

      const result = await parser.parseFile(testFilePath, content);

      expect(result.errors).toHaveLength(0);
      expect(result.blocks).toHaveLength(2);

      const region = result.blocks.find(b => b.name === 'region');
      expect(region).toBeDefined();
      expect(region?.blockType).toBe('variable');
      expect(region?.name).toBe('region');

      const instanceCount = result.blocks.find(b => b.name === 'instance_count');
      expect(instanceCount).toBeDefined();
      expect(instanceCount?.blockType).toBe('variable');
      expect(instanceCount?.name).toBe('instance_count');
    });

    it('should parse output blocks', async () => {
      const content = `
output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.main.id
}

output "instance_ips" {
  description = "IP addresses of instances"
  value       = aws_instance.web[*].public_ip
  sensitive   = false
}
      `;

      const result = await parser.parseFile(testFilePath, content);

      expect(result.errors).toHaveLength(0);
      expect(result.blocks).toHaveLength(2);

      const vpcId = result.blocks.find(b => b.name === 'vpc_id');
      expect(vpcId).toBeDefined();
      expect(vpcId?.blockType).toBe('output');
      expect(vpcId?.name).toBe('vpc_id');

      const instanceIps = result.blocks.find(b => b.name === 'instance_ips');
      expect(instanceIps).toBeDefined();
      expect(instanceIps?.blockType).toBe('output');
      expect(instanceIps?.name).toBe('instance_ips');
    });

    it('should parse locals blocks', async () => {
      const content = `
locals {
  common_tags = {
    Environment = "production"
    Project     = "myapp"
  }
  
  vpc_cidr = "10.0.0.0/16"
}
      `;

      const result = await parser.parseFile(testFilePath, content);

      expect(result.errors).toHaveLength(0);
      expect(result.blocks).toHaveLength(1);

      const locals = result.blocks[0];
      expect(locals.blockType).toBe('locals');
      expect(locals.name).toBeUndefined(); // locals don't have names
    });

    it('should parse .tf.json files', async () => {
      const jsonContent = `{
  "resource": {
    "aws_instance": {
      "web": {
        "ami": "ami-12345",
        "instance_type": "t3.micro"
      }
    }
  },
  "variable": {
    "region": {
      "type": "string",
      "default": "us-east-1"
    }
  }
}`;

      const result = await parser.parseFile('/test/main.tf.json', jsonContent);

      expect(result.errors).toHaveLength(0);
      expect(result.blocks).toHaveLength(2);

      const instance = result.blocks.find(b => b.blockType === 'resource');
      expect(instance).toBeDefined();
      expect(instance?.kind).toBe('aws_instance');
      expect(instance?.name).toBe('web');

      const variable = result.blocks.find(b => b.blockType === 'variable');
      expect(variable).toBeDefined();
      expect(variable?.name).toBe('region');
    });

    it('should handle parser configuration', async () => {
      const content = `
variable "test" {
  type = string
}

output "test" {
  value = "test"
}

locals {
  test = "value"
}

data "aws_ami" "test" {
  most_recent = true
}
      `;

      // Test excluding specific block types
      const result = await parser.parseFile(testFilePath, content, {
        includeVariables: false,
        includeOutputs: false,
        includeLocals: false,
        includeDataSources: false
      });

      expect(result.blocks).toHaveLength(0);
    });

    it('should handle module path context', async () => {
      const content = `
resource "aws_instance" "web" {
  ami = "ami-12345"
}
      `;

      const result = await parser.parseFile(testFilePath, content, {
        modulePath: ['module.vpc', 'module.compute']
      });

      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].modulePath).toEqual(['module.vpc', 'module.compute']);
    });

    it('should handle parsing errors gracefully', async () => {
      const invalidContent = `
resource "aws_instance" "web" {
  ami = ami-12345  // Missing quotes
  instance_type = 
}
      `;

      const result = await parser.parseFile(testFilePath, invalidContent);

      // Should not throw, but may have errors
      expect(result).toBeDefined();
      expect(result.blocks).toBeDefined();
      expect(result.errors).toBeDefined();
    });

    it('should extract provider from resource kind', async () => {
      const content = `
resource "google_compute_instance" "vm" {
  name = "test-vm"
}

resource "azurerm_virtual_machine" "vm" {
  name = "test-vm"
}
      `;

      const result = await parser.parseFile(testFilePath, content);

      expect(result.blocks).toHaveLength(2);

      const googleResource = result.blocks.find(b => b.kind === 'google_compute_instance');
      expect(googleResource?.provider).toBe('google');

      const azureResource = result.blocks.find(b => b.kind === 'azurerm_virtual_machine');
      expect(azureResource?.provider).toBe('azurerm');
    });
  });
});

describe('TerraformParserFactory', () => {
  describe('getParser', () => {
    it('should return HCL2Parser for .tf files', () => {
      const parser = TerraformParserFactory.getParser('/path/to/main.tf');
      expect(parser).toBeInstanceOf(HCL2Parser);
    });

    it('should return HCL2Parser for .tf.json files', () => {
      const parser = TerraformParserFactory.getParser('/path/to/main.tf.json');
      expect(parser).toBeInstanceOf(HCL2Parser);
    });

    it('should return null for unsupported files', () => {
      const parser = TerraformParserFactory.getParser('/path/to/main.js');
      expect(parser).toBeNull();
    });
  });

  describe('parseFile', () => {
    it('should parse file using appropriate parser', async () => {
      const content = `
resource "aws_instance" "web" {
  ami = "ami-12345"
}
      `;

      const result = await TerraformParserFactory.parseFile('/test/main.tf', content);

      expect(result.errors).toHaveLength(0);
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].blockType).toBe('resource');
    });

    it('should return error for unsupported files', async () => {
      const result = await TerraformParserFactory.parseFile('/test/main.js', 'console.log("hello");');

      expect(result.blocks).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('No suitable parser found');
    });
  });
});

describe('Address creation and utilities', () => {
  it('should create proper address ranges', async () => {
    const parser = new HCL2Parser();
    const content = `
resource "aws_instance" "web" {
  ami = "ami-12345"
}
    `;

    const result = await parser.parseFile('/test/main.tf', content);
    
    expect(result.blocks).toHaveLength(1);
    const block = result.blocks[0];
    
    expect(block.range).toBeDefined();
    expect(block.range.start).toBeGreaterThanOrEqual(0);
    expect(block.range.end).toBeGreaterThan(block.range.start);
  });

  it('should handle complex nested blocks', async () => {
    const parser = new HCL2Parser();
    const content = `
resource "aws_security_group" "web" {
  name = "web-sg"
  
  ingress {
    from_port = 80
    to_port   = 80
    protocol  = "tcp"
    
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  egress {
    from_port = 0
    to_port   = 0
    protocol  = "-1"
    
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  tags = {
    Name = "WebSecurityGroup"
  }
}
    `;

    const result = await parser.parseFile('/test/main.tf', content);
    
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].blockType).toBe('resource');
    expect(result.blocks[0].kind).toBe('aws_security_group');
    expect(result.blocks[0].name).toBe('web');
  });
});
