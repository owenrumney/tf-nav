import * as path from 'path';

import * as vscode from 'vscode';

/**
 * File discovery service for Terraform files
 */
export class TerraformFileCollector {
  private readonly outputChannel: vscode.OutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel(
      'Terraform Navigator'
    );
  }

  /**
   * Find all .tf and .tf.json files in the workspace
   * @returns Promise<string[]> Array of absolute file paths
   */
  async findTfFiles(): Promise<string[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this.outputChannel.appendLine('No workspace folders found');
      return [];
    }

    const config = vscode.workspace.getConfiguration('tfnav');
    const configuredIgnorePatterns = config.get<string[]>('ignore', ['**/.terraform/**']);
    const includeTerraformCache = config.get<boolean>('includeTerraformCache', false);
    
    // If includeTerraformCache is false, ensure .terraform is in ignore patterns
    let ignorePatterns = [...configuredIgnorePatterns];
    if (!includeTerraformCache) {
      // Add .terraform patterns if not already present
      const terraformPatterns = ['**/.terraform/**', '**/.terraform/*'];
      for (const pattern of terraformPatterns) {
        if (!ignorePatterns.includes(pattern)) {
          ignorePatterns.push(pattern);
        }
      }
    } else {
      // If includeTerraformCache is true, remove .terraform patterns from ignore list
      ignorePatterns = ignorePatterns.filter(pattern => 
        !pattern.includes('.terraform')
      );
    }

    this.outputChannel.appendLine('Starting Terraform file discovery...');
    this.outputChannel.appendLine(
      `Ignore patterns: ${JSON.stringify(ignorePatterns)}`
    );

    const allFiles: string[] = [];

    for (const workspaceFolder of workspaceFolders) {
      const workspacePath = workspaceFolder.uri.fsPath;
      this.outputChannel.appendLine(`Scanning workspace: ${workspacePath}`);

      try {
        // Find .tf files
        const tfFiles = await vscode.workspace.findFiles(
          new vscode.RelativePattern(workspaceFolder, '**/*.tf'),
          this.createExcludePattern(ignorePatterns)
        );

        // Find .tf.json files
        const tfJsonFiles = await vscode.workspace.findFiles(
          new vscode.RelativePattern(workspaceFolder, '**/*.tf.json'),
          this.createExcludePattern(ignorePatterns)
        );

        // Convert URIs to absolute paths and combine
        const workspaceFiles = [
          ...tfFiles.map((uri) => uri.fsPath),
          ...tfJsonFiles.map((uri) => uri.fsPath),
        ];

        allFiles.push(...workspaceFiles);
        this.outputChannel.appendLine(
          `Found ${workspaceFiles.length} Terraform files in ${workspaceFolder.name}`
        );

        // Log each file for debugging
        workspaceFiles.forEach((file) => {
          const relativePath = path.relative(workspacePath, file);
          this.outputChannel.appendLine(`  - ${relativePath}`);
        });
      } catch (error) {
        this.outputChannel.appendLine(
          `Error scanning workspace ${workspaceFolder.name}: ${error}`
        );
      }
    }

    // Sort files for consistent ordering
    allFiles.sort();

    this.outputChannel.appendLine(
      `Total Terraform files discovered: ${allFiles.length}`
    );
    this.outputChannel.hide();

    return allFiles;
  }

  /**
   * Create exclude pattern from ignore configuration
   */
  private createExcludePattern(ignorePatterns: string[]): string {
    if (ignorePatterns.length === 0) {
      return '';
    }

    // Join patterns with OR operator
    return `{${ignorePatterns.join(',')}}`;
  }

  /**
   * Check if a file path should be ignored based on ignore patterns
   */
  private shouldIgnoreFile(
    filePath: string,
    ignorePatterns: string[]
  ): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/');

    return ignorePatterns.some((pattern) => {
      // Simple glob matching for common patterns
      if (pattern.includes('**')) {
        const regexPattern = pattern
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*')
          .replace(/\?/g, '[^/]');
        const regex = new RegExp(regexPattern);
        return regex.test(normalizedPath);
      } else {
        return normalizedPath.includes(pattern.replace(/\*/g, ''));
      }
    });
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.outputChannel.dispose();
  }
}

/**
 * Convenience function to find Terraform files
 */
export async function findTfFiles(): Promise<string[]> {
  const collector = new TerraformFileCollector();
  try {
    return await collector.findTfFiles();
  } finally {
    collector.dispose();
  }
}
