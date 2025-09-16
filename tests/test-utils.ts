// Test utilities and helpers
import * as fs from 'fs';
import * as path from 'path';

export interface TestFile {
  path: string;
  relativePath: string;
  isDirectory: boolean;
  shouldBeDiscovered: boolean;
}

export class TestWorkspaceHelper {
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  /**
   * Get the workspace path
   */
  get workspace(): string {
    return this.workspacePath;
  }

  /**
   * Get all files in the test workspace
   */
  getAllFiles(): TestFile[] {
    const files: TestFile[] = [];
    
    const walkDir = (currentDir: string) => {
      if (!fs.existsSync(currentDir)) {
        return;
      }

      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relativePath = path.relative(this.workspacePath, fullPath);
        
        const testFile: TestFile = {
          path: fullPath,
          relativePath,
          isDirectory: entry.isDirectory(),
          shouldBeDiscovered: this.shouldBeDiscovered(relativePath, entry.isDirectory()),
        };
        
        files.push(testFile);
        
        if (entry.isDirectory()) {
          walkDir(fullPath);
        }
      }
    };
    
    walkDir(this.workspacePath);
    return files;
  }

  /**
   * Get expected Terraform files that should be discovered
   */
  getExpectedTerraformFiles(): string[] {
    return [
      'main.tf',
      'variables.tf',
      'data.tf',
      'locals.tf',
      'outputs.tf',
      's3.tf.json',
      'modules/rds/main.tf',
      'modules/rds/variables.tf',
      'modules/rds/outputs.tf',
      'modules/cloudwatch/main.tf',
      'modules/cloudwatch/variables.tf',
      'modules/cloudwatch/outputs.tf',
      'modules/cloudwatch/data.tf',
    ];
  }

  /**
   * Get files that should be ignored
   */
  getIgnoredFiles(): string[] {
    return [
      '.terraform/terraform.tfstate',
      '.terraform/providers/registry.terraform.io/hashicorp/aws/5.0.0/linux_amd64/terraform-provider-aws_v5.0.0_x5',
      '.terraform/modules/modules.json',
      'scripts/userdata.sh',
      'terraform.tfvars.example',
      'README.md',
    ];
  }

  /**
   * Determine if a file should be discovered based on ignore patterns
   */
  private shouldBeDiscovered(relativePath: string, isDirectory: boolean): boolean {
    // Should be ignored if in .terraform directory
    if (relativePath.includes('.terraform')) {
      return false;
    }
    
    // Should be discovered if it's a .tf or .tf.json file
    if (!isDirectory && (relativePath.endsWith('.tf') || relativePath.endsWith('.tf.json'))) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if the test workspace exists and has expected structure
   */
  validateWorkspace(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!fs.existsSync(this.workspacePath)) {
      errors.push(`Test workspace not found at: ${this.workspacePath}`);
      return { isValid: false, errors };
    }
    
    // Check for key files
    const keyFiles = ['main.tf', 'variables.tf', 'modules/rds/main.tf'];
    for (const file of keyFiles) {
      const filePath = path.join(this.workspacePath, file);
      if (!fs.existsSync(filePath)) {
        errors.push(`Key test file missing: ${file}`);
      }
    }
    
    // Check for .terraform directory (should exist for ignore testing)
    const terraformDir = path.join(this.workspacePath, '.terraform');
    if (!fs.existsSync(terraformDir)) {
      errors.push('.terraform directory missing (needed for ignore pattern testing)');
    }
    
    return { isValid: errors.length === 0, errors };
  }
}

/**
 * Create a test workspace helper for the default test workspace
 */
export function createTestWorkspaceHelper(): TestWorkspaceHelper {
  const workspacePath = path.join(__dirname, 'workspace');
  return new TestWorkspaceHelper(workspacePath);
}

/**
 * Mock VS Code URI
 */
export function createMockUri(fsPath: string) {
  return { fsPath };
}

/**
 * Sort file paths for consistent testing
 */
export function sortFilePaths(paths: string[]): string[] {
  return paths.sort((a, b) => a.localeCompare(b));
}
