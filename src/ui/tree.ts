/**
 * TreeDataProvider for Terraform Navigator
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectIndex, Address, createTerraformAddress } from '../types';
import { TerraformWatcher } from '../indexer/watch';

/**
 * Tree item representing a Terraform block or group
 */
export class TerraformTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly itemType?: string,
    public readonly address?: Address,
    public readonly terraformAddress?: string,
    public readonly resourceUri?: vscode.Uri,
    public readonly range?: { start: number; end: number }
  ) {
    super(label, collapsibleState);

    // Set tooltip with detailed information
    if (address) {
      const modulePath = address.modulePath.length > 0 ? address.modulePath.join('.') + '.' : '';
      const fileName = path.basename(address.file);
      this.tooltip = `${modulePath}${terraformAddress}\n${fileName}:${address.range.start}-${address.range.end}`;
    } else {
      this.tooltip = this.label;
    }

    this.contextValue = this.itemType || 'terraform-item';

    // Set appropriate icons based on item type
    if (this.itemType === 'file-group' && this.resourceUri) {
      // For file groups, set the resourceUri so VS Code can determine the file type icon
      // Don't set iconPath - let VS Code handle it automatically
      this.iconPath = vscode.ThemeIcon.File;
    } else {
      this.iconPath = TerraformTreeItem.getIconForType(this.itemType);
    }

    // Make clickable items that have addresses
    if (this.address && this.resourceUri) {
      this.command = {
        command: 'tfnav.reveal',
        title: 'Reveal in Editor',
        arguments: [this],
      };
    }
  }

  public static getIconForType(itemType?: string): vscode.ThemeIcon {
    switch (itemType) {
      case 'resource':
        return new vscode.ThemeIcon('symbol-class');
      case 'data':
        return new vscode.ThemeIcon('database');
      case 'module':
        return new vscode.ThemeIcon('package');
      case 'variable':
        return new vscode.ThemeIcon('symbol-variable');
      case 'output':
        return new vscode.ThemeIcon('symbol-method');
      case 'locals':
        return new vscode.ThemeIcon('symbol-constant');
      case 'resource-kind-group':
        return new vscode.ThemeIcon('symbol-namespace');
      case 'file-group':
        return new vscode.ThemeIcon('file');
      case 'info':
        return new vscode.ThemeIcon('clock');
      default:
        return new vscode.ThemeIcon('symbol-misc');
    }
  }
}

/**
 * Main TreeDataProvider for Terraform Navigator
 */
export class TerraformTreeDataProvider implements vscode.TreeDataProvider<TerraformTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TerraformTreeItem | undefined | null | void> = 
    new vscode.EventEmitter<TerraformTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TerraformTreeItem | undefined | null | void> = 
    this._onDidChangeTreeData.event;

  private currentIndex: ProjectIndex | null = null;

  constructor(private watcher: TerraformWatcher) {

    // Listen to watcher events
    this.watcher.onIndexBuilt(this.onIndexUpdated.bind(this));
    this.watcher.onFilesUpdated(this.onFilesChanged.bind(this));
    this.watcher.onFilesAdded(this.onFilesChanged.bind(this));
    this.watcher.onFilesDeleted(this.onFilesChanged.bind(this));
    this.watcher.onParseErrors(this.onParseErrors.bind(this));
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TerraformTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TerraformTreeItem): Thenable<TerraformTreeItem[]> {
    if (!element) {
      // Root level
      return this.getRootChildren();
    }

    // Child items for expandable nodes
    if (element.contextValue === 'resource-kind-group') {
      return this.getResourcesForKind(element.label);
    } else if (element.contextValue === 'file-group') {
      return this.getBlocksForFile(element.terraformAddress!); // Using terraformAddress to store file path
    } else if (element.contextValue?.endsWith('-group')) {
      // Handle other block type groups (variable-group, output-group, etc.)
      const blockType = element.contextValue.replace('-group', '');
      return this.getBlocksForType(blockType, element.label);
    }

    return Promise.resolve([]);
  }

  private async getRootChildren(): Promise<TerraformTreeItem[]> {
    const config = vscode.workspace.getConfiguration('tfnav');
    const viewMode = config.get<string>('viewMode', 'type');

    if (!this.currentIndex) {
      return [
        new TerraformTreeItem(
          'Building index...',
          vscode.TreeItemCollapsibleState.None,
          'info'
        ),
      ];
    }

    if (this.currentIndex.blocks.length === 0) {
      return [
        new TerraformTreeItem(
          `No Terraform blocks found (View: ${viewMode})`,
          vscode.TreeItemCollapsibleState.None,
          'info'
        ),
      ];
    }

    // Filter blocks based on settings
    const filteredIndex = this.getFilteredIndex();

    if (viewMode === 'type') {
      return this.getBlocksByType(filteredIndex);
    } else {
      return this.getBlocksByFile(filteredIndex);
    }
  }

  private getFilteredIndex(): ProjectIndex {
    if (!this.currentIndex) {
      return { blocks: [], byType: new Map(), byFile: new Map() };
    }

    const config = vscode.workspace.getConfiguration('tfnav');
    const includeDataSources = config.get<boolean>('includeDataSources', true);

    if (includeDataSources) {
      return this.currentIndex;
    }

    // Filter out data sources
    const filteredBlocks = this.currentIndex.blocks.filter(block => block.blockType !== 'data');
    
    // Rebuild maps
    const filteredIndex: ProjectIndex = {
      blocks: filteredBlocks,
      byType: new Map(),
      byFile: new Map(),
      refs: this.currentIndex.refs
    };

    // Rebuild byType map
    const typeGroups = new Map<string, Address[]>();
    for (const block of filteredBlocks) {
      const blocks = typeGroups.get(block.blockType) || [];
      blocks.push(block);
      typeGroups.set(block.blockType, blocks);
    }

    for (const [blockType, blocks] of typeGroups.entries()) {
      const sortedBlocks = blocks.sort((a, b) => {
        const nameA = a.name || '';
        const nameB = b.name || '';
        if (nameA !== nameB) {
          return nameA.localeCompare(nameB);
        }
        const kindA = a.kind || '';
        const kindB = b.kind || '';
        if (kindA !== kindB) {
          return kindA.localeCompare(kindB);
        }
        return a.file.localeCompare(b.file);
      });
      filteredIndex.byType.set(blockType, sortedBlocks);
    }

    // Rebuild byFile map
    const fileGroups = new Map<string, Address[]>();
    for (const block of filteredBlocks) {
      const blocks = fileGroups.get(block.file) || [];
      blocks.push(block);
      fileGroups.set(block.file, blocks);
    }

    for (const [filePath, blocks] of fileGroups.entries()) {
      const sortedBlocks = blocks.sort((a, b) => {
        if (a.range.start !== b.range.start) {
          return a.range.start - b.range.start;
        }
        return a.range.end - b.range.end;
      });
      filteredIndex.byFile.set(filePath, sortedBlocks);
    }

    return filteredIndex;
  }

  private async getBlocksByType(index: ProjectIndex): Promise<TerraformTreeItem[]> {
    const typeItems: TerraformTreeItem[] = [];
    
    // Group resources by kind for better organization
    const resourceKinds = new Map<string, Address[]>();
    const otherBlocks = new Map<string, Address[]>();

    for (const [blockType, blocks] of index.byType.entries()) {
      if (blockType === 'resource') {
        // Group resources by kind
        for (const block of blocks) {
          if (block.kind) {
            const kindBlocks = resourceKinds.get(block.kind) || [];
            kindBlocks.push(block);
            resourceKinds.set(block.kind, kindBlocks);
          }
        }
      } else {
        otherBlocks.set(blockType, blocks);
      }
    }

    // Add resource kind groups
    for (const [kind, blocks] of Array.from(resourceKinds.entries()).sort()) {
      const kindItem = new TerraformTreeItem(
        `${kind} (${blocks.length})`,
        vscode.TreeItemCollapsibleState.Collapsed,
        'resource-kind-group'
      );
      typeItems.push(kindItem);
    }

    // Add other block type groups
    for (const [blockType, blocks] of Array.from(otherBlocks.entries()).sort()) {
      if (blocks.length > 0) {
        const typeItem = new TerraformTreeItem(
          `${blockType} (${blocks.length})`,
          vscode.TreeItemCollapsibleState.Collapsed,
          `${blockType}-group`
        );
        typeItem.contextValue = `${blockType}-group`;
        typeItems.push(typeItem);
      }
    }

    return typeItems;
  }

  private async getBlocksByFile(index: ProjectIndex): Promise<TerraformTreeItem[]> {
    const fileItems: TerraformTreeItem[] = [];
    
    // Get workspace folders to calculate relative paths
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspaceRoot = workspaceFolders && workspaceFolders.length > 0 
      ? workspaceFolders[0].uri.fsPath 
      : '';
    
    for (const [filePath, blocks] of index.byFile.entries()) {
      // Calculate relative path from workspace root
      let displayPath: string;
      if (workspaceRoot && filePath.startsWith(workspaceRoot)) {
        displayPath = path.relative(workspaceRoot, filePath);
      } else {
        displayPath = path.basename(filePath);
      }
      
      const fileItem = new TerraformTreeItem(
        `${displayPath} (${blocks.length})`,
        vscode.TreeItemCollapsibleState.Collapsed,
        'file-group',
        undefined,
        filePath, // Store file path in terraformAddress field
        vscode.Uri.file(filePath) // Pass the file URI for proper icon
      );
      fileItems.push(fileItem);
    }

    return fileItems.sort((a, b) => a.label.localeCompare(b.label));
  }

  private async getResourcesForKind(kindLabel: string): Promise<TerraformTreeItem[]> {
    if (!this.currentIndex) return [];

    // Extract kind from label (e.g., "aws_security_group (3)" -> "aws_security_group")
    const kind = kindLabel.split(' ')[0];
    
    const resources = this.currentIndex.byType.get('resource') || [];
    const kindResources = resources.filter(resource => resource.kind === kind);
    
    return kindResources.map(resource => this.createBlockTreeItem(resource));
  }

  private async getBlocksForType(blockType: string, typeLabel?: string): Promise<TerraformTreeItem[]> {
    if (!this.currentIndex) return [];

    const blocks = this.currentIndex.byType.get(blockType) || [];
    return blocks.map(block => this.createBlockTreeItem(block));
  }

  private async getBlocksForFile(filePath: string): Promise<TerraformTreeItem[]> {
    if (!this.currentIndex) return [];

    const blocks = this.currentIndex.byFile.get(filePath) || [];
    return blocks.map(block => this.createBlockTreeItem(block));
  }

  private createBlockTreeItem(block: Address): TerraformTreeItem {
    const terraformAddress = createTerraformAddress(block);
    let label = terraformAddress;
    
    // Create more readable labels
    if (block.blockType === 'resource' || block.blockType === 'data') {
      label = `${block.kind}.${block.name}`;
    } else if (block.name) {
      label = block.name;
    } else if (block.blockType === 'locals') {
      label = 'locals';
    }

    return new TerraformTreeItem(
      label,
      vscode.TreeItemCollapsibleState.None,
      block.blockType,
      block,
      terraformAddress,
      vscode.Uri.file(block.file),
      block.range
    );
  }

  // Event handlers
  private onIndexUpdated(result: any): void {
    this.currentIndex = result.index;
    this.refresh();
    
    const blockCount = result.stats.totalBlocks;
    const fileCount = result.stats.filesProcessed;
    vscode.window.showInformationMessage(
      `Terraform Navigator: Index built - ${blockCount} blocks from ${fileCount} files`
    );
  }

  private onFilesChanged(event: {files: string[], index: ProjectIndex}): void {
    this.currentIndex = event.index;
    this.refresh();
    
    const blockCount = event.index.blocks.length;
    const changedCount = event.files.length;
    vscode.window.showInformationMessage(
      `Terraform Navigator: Updated ${changedCount} files - ${blockCount} total blocks`
    );
  }

  private onParseErrors(errors: Array<{file: string; error: string}>): void {
    if (errors.length > 0) {
      const errorCount = errors.length;
      vscode.window.showWarningMessage(
        `Terraform Navigator: ${errorCount} parse errors occurred`
      );
    }
  }

  dispose(): void {
    // Clean up event listeners if needed
  }
}
