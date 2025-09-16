/**
 * File watcher for Terraform files with incremental index updates
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectIndex, Address, ParseResult } from '../types';
import { TerraformParserFactory } from './parser';
import { TerraformFileCollector } from './files';
import { buildIndex, BuildIndexResult } from './buildIndex';
import { TerraformWorkerManager, WorkerProgressUpdate } from './worker';

/**
 * Events emitted by the file watcher
 */
export interface TerraformWatcherEvents {
  /** Emitted when index is initially built */
  indexBuilt: (result: BuildIndexResult) => void;
  
  /** Emitted when files are updated */
  filesUpdated: (updatedFiles: string[], index: ProjectIndex) => void;
  
  /** Emitted when files are added */
  filesAdded: (addedFiles: string[], index: ProjectIndex) => void;
  
  /** Emitted when files are deleted */
  filesDeleted: (deletedFiles: string[], index: ProjectIndex) => void;
  
  /** Emitted when there are parse errors */
  parseErrors: (errors: Array<{file: string; error: string}>) => void;
}

/**
 * Configuration for the file watcher
 */
export interface TerraformWatcherConfig {
  /** Debounce delay in milliseconds */
  debounceMs?: number;
  
  /** Whether to log watcher activity */
  verbose?: boolean;
  
  /** Maximum number of files to process in one batch */
  maxBatchSize?: number;
  
  /** Whether to continue on parse errors */
  continueOnError?: boolean;
}

/**
 * File watcher for Terraform files with incremental updates
 */
export class TerraformWatcher implements vscode.Disposable {
  private fileCollector: TerraformFileCollector;
  private currentIndex: ProjectIndex | null = null;
  private fileWatcher: vscode.FileSystemWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingChanges = new Set<string>();
  private outputChannel: vscode.OutputChannel;
  private disposables: vscode.Disposable[] = [];
  private workerManager: TerraformWorkerManager;
  
  // Event emitters
  private onIndexBuiltEmitter = new vscode.EventEmitter<BuildIndexResult>();
  private onFilesUpdatedEmitter = new vscode.EventEmitter<{files: string[], index: ProjectIndex}>();
  private onFilesAddedEmitter = new vscode.EventEmitter<{files: string[], index: ProjectIndex}>();
  private onFilesDeletedEmitter = new vscode.EventEmitter<{files: string[], index: ProjectIndex}>();
  private onParseErrorsEmitter = new vscode.EventEmitter<Array<{file: string; error: string}>>();

  // Public event accessors
  public readonly onIndexBuilt = this.onIndexBuiltEmitter.event;
  public readonly onFilesUpdated = this.onFilesUpdatedEmitter.event;
  public readonly onFilesAdded = this.onFilesAddedEmitter.event;
  public readonly onFilesDeleted = this.onFilesDeletedEmitter.event;
  public readonly onParseErrors = this.onParseErrorsEmitter.event;

  constructor(
    fileCollector: TerraformFileCollector,
    private config: TerraformWatcherConfig = {}
  ) {
    this.fileCollector = fileCollector;
    this.workerManager = new TerraformWorkerManager();
    this.config = {
      debounceMs: 250,
      verbose: false,
      maxBatchSize: 50,
      continueOnError: true,
      ...config
    };
    
    this.outputChannel = vscode.window.createOutputChannel('Terraform Navigator - Watcher');
    this.disposables.push(this.outputChannel);
    
    // Register event emitter disposables
    this.disposables.push(
      this.onIndexBuiltEmitter,
      this.onFilesUpdatedEmitter,
      this.onFilesAddedEmitter,
      this.onFilesDeletedEmitter,
      this.onParseErrorsEmitter
    );
    
    this.log('Terraform file watcher initialized');
  }

  /**
   * Start watching for file changes
   */
  public async start(): Promise<void> {
    this.log('Starting Terraform file watcher...');
    
    // Build initial index
    await this.buildInitialIndex();
    
    // Set up file watcher
    this.setupFileWatcher();
    
    this.log('Terraform file watcher started');
  }

  /**
   * Stop watching for file changes
   */
  public stop(): void {
    this.log('Stopping Terraform file watcher...');
    
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
      this.fileWatcher = null;
    }
    
    this.pendingChanges.clear();
    this.log('Terraform file watcher stopped');
  }

  /**
   * Get the current index
   */
  public getCurrentIndex(): ProjectIndex | null {
    return this.currentIndex;
  }

  /**
   * Force a full rebuild of the index
   */
  public async rebuildIndex(): Promise<void> {
    this.log('Forcing index rebuild...');
    await this.buildInitialIndex();
  }

  /**
   * Build the initial index from all discovered files
   */
  private async buildInitialIndex(): Promise<void> {
    try {
      this.log('Building initial index...');
      
      const terraformFiles = await this.fileCollector.findTfFiles();
      this.log(`Found ${terraformFiles.length} Terraform files`);
      
      const result = await this.workerManager.buildIndex(terraformFiles, {
        verbose: this.config.verbose,
        continueOnError: this.config.continueOnError
      }, (progress: WorkerProgressUpdate) => {
        this.log(`Progress: ${progress.processed}/${progress.total} - ${progress.currentFile}`);
      });
      
      this.currentIndex = result.index;
      
      this.log(`Initial index built: ${result.stats.totalBlocks} blocks from ${result.stats.filesProcessed} files`);
      
      if (result.errors.length > 0) {
        this.log(`Parse errors: ${result.errors.length}`);
        this.onParseErrorsEmitter.fire(result.errors);
      }
      
      this.onIndexBuiltEmitter.fire(result);
      
    } catch (error) {
      this.log(`Failed to build initial index: ${error}`);
      throw error;
    }
  }

  /**
   * Set up file system watcher
   */
  private setupFileWatcher(): void {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }
    
    // Watch for .tf and .tf.json files
    this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{tf,tf.json}');
    
    // Handle file changes
    this.fileWatcher.onDidChange((uri) => {
      this.log(`File changed: ${uri.fsPath}`);
      TerraformParserFactory.evictFromCache(uri.fsPath);
      this.scheduleUpdate(uri.fsPath, 'changed');
    });
    
    this.fileWatcher.onDidCreate((uri) => {
      this.log(`File created: ${uri.fsPath}`);
      this.scheduleUpdate(uri.fsPath, 'created');
    });
    
    this.fileWatcher.onDidDelete((uri) => {
      this.log(`File deleted: ${uri.fsPath}`);
      TerraformParserFactory.evictFromCache(uri.fsPath);
      this.scheduleUpdate(uri.fsPath, 'deleted');
    });
    
    this.disposables.push(this.fileWatcher);
  }

  /**
   * Schedule a debounced update
   */
  private scheduleUpdate(filePath: string, changeType: 'changed' | 'created' | 'deleted'): void {
    this.pendingChanges.add(`${changeType}:${filePath}`);
    
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    
    this.debounceTimer = setTimeout(() => {
      this.processUpdates();
    }, this.config.debounceMs);
  }

  /**
   * Process all pending updates
   */
  private async processUpdates(): Promise<void> {
    if (this.pendingChanges.size === 0 || !this.currentIndex) {
      return;
    }
    
    const changes = Array.from(this.pendingChanges);
    this.pendingChanges.clear();
    this.debounceTimer = null;
    
    this.log(`Processing ${changes.length} file changes...`);
    
    const changedFiles: string[] = [];
    const createdFiles: string[] = [];
    const deletedFiles: string[] = [];
    
    // Categorize changes
    for (const change of changes) {
      const [changeType, filePath] = change.split(':', 2);
      
      switch (changeType) {
        case 'changed':
          changedFiles.push(filePath);
          break;
        case 'created':
          createdFiles.push(filePath);
          break;
        case 'deleted':
          deletedFiles.push(filePath);
          break;
      }
    }
    
    try {
      // Process deletions first
      if (deletedFiles.length > 0) {
        await this.processDeletedFiles(deletedFiles);
      }
      
      // Process changes and additions
      const filesToReparse = [...changedFiles, ...createdFiles];
      if (filesToReparse.length > 0) {
        await this.processChangedFiles(filesToReparse, createdFiles);
      }
      
      this.log(`Update complete. Index now has ${this.currentIndex.blocks.length} blocks`);
      
    } catch (error) {
      this.log(`Failed to process updates: ${error}`);
      this.onParseErrorsEmitter.fire([{
        file: 'watcher',
        error: `Update processing failed: ${error}`
      }]);
    }
  }

  /**
   * Process deleted files by removing them from the index
   */
  private async processDeletedFiles(deletedFiles: string[]): Promise<void> {
    if (!this.currentIndex) return;
    
    this.log(`Removing ${deletedFiles.length} deleted files from index`);
    
    // Remove blocks from deleted files
    const remainingBlocks = this.currentIndex.blocks.filter(
      block => !deletedFiles.includes(block.file)
    );
    
    this.currentIndex.blocks = remainingBlocks;
    this.rebuildMaps();
    
    this.onFilesDeletedEmitter.fire({
      files: deletedFiles,
      index: this.currentIndex
    });
  }

  /**
   * Process changed/created files by reparsing and updating the index
   */
  private async processChangedFiles(filesToReparse: string[], createdFiles: string[]): Promise<void> {
    if (!this.currentIndex) return;
    
    this.log(`Reparsing ${filesToReparse.length} files`);
    
    const errors: Array<{file: string; error: string}> = [];
    const updatedBlocks: Address[] = [];
    
    // Reparse each file
    for (const filePath of filesToReparse) {
      try {
        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
        const contentStr = Buffer.from(content).toString('utf8');
        
        const parseResult = await TerraformParserFactory.parseFile(filePath, contentStr);
        
        if (parseResult.errors.length > 0) {
          errors.push(...parseResult.errors.map(err => ({
            file: filePath,
            error: err.message
          })));
        }
        
        updatedBlocks.push(...parseResult.blocks);
        
      } catch (error) {
        errors.push({
          file: filePath,
          error: `Failed to read/parse file: ${error}`
        });
        
        if (!this.config.continueOnError) {
          break;
        }
      }
    }
    
    // Remove old blocks from these files
    this.currentIndex.blocks = this.currentIndex.blocks.filter(
      block => !filesToReparse.includes(block.file)
    );
    
    // Add new blocks
    this.currentIndex.blocks.push(...updatedBlocks);
    
    // Rebuild organized maps
    this.rebuildMaps();
    
    // Emit appropriate events
    const changedFiles = filesToReparse.filter(f => !createdFiles.includes(f));
    
    if (changedFiles.length > 0) {
      this.onFilesUpdatedEmitter.fire({
        files: changedFiles,
        index: this.currentIndex
      });
    }
    
    if (createdFiles.length > 0) {
      this.onFilesAddedEmitter.fire({
        files: createdFiles,
        index: this.currentIndex
      });
    }
    
    if (errors.length > 0) {
      this.onParseErrorsEmitter.fire(errors);
    }
  }

  /**
   * Rebuild the byType and byFile maps after index changes
   */
  private rebuildMaps(): void {
    if (!this.currentIndex) return;
    
    // Clear existing maps
    this.currentIndex.byType.clear();
    this.currentIndex.byFile.clear();
    
    // Group by type with sorting
    const typeGroups = new Map<string, Address[]>();
    for (const block of this.currentIndex.blocks) {
      const blocks = typeGroups.get(block.blockType) || [];
      blocks.push(block);
      typeGroups.set(block.blockType, blocks);
    }
    
    // Sort and populate byType map
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
      
      this.currentIndex.byType.set(blockType, sortedBlocks);
    }
    
    // Group by file with sorting
    const fileGroups = new Map<string, Address[]>();
    for (const block of this.currentIndex.blocks) {
      const blocks = fileGroups.get(block.file) || [];
      blocks.push(block);
      fileGroups.set(block.file, blocks);
    }
    
    // Sort and populate byFile map
    for (const [filePath, blocks] of fileGroups.entries()) {
      const sortedBlocks = blocks.sort((a, b) => {
        if (a.range.start !== b.range.start) {
          return a.range.start - b.range.start;
        }
        return a.range.end - b.range.end;
      });
      
      this.currentIndex.byFile.set(filePath, sortedBlocks);
    }
  }

  /**
   * Log a message if verbose logging is enabled
   */
  private log(message: string): void {
    if (this.config.verbose) {
      console.log(`[TerraformWatcher] ${message}`);
    }
    this.outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  /**
   * Dispose of all resources
   */
  public dispose(): void {
    this.stop();
    
    // Dispose worker manager
    this.workerManager.dispose();
    
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }
}
