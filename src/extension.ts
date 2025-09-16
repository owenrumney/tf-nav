import * as vscode from 'vscode';
import { TerraformFileCollector } from './indexer/files';
import { TerraformWatcher } from './indexer/watch';
import { TerraformTreeDataProvider } from './ui/tree';
import { TerraformStatusBar } from './ui/status';
import { TerraformGraphWebview } from './graph/webview';
import { ProjectIndex } from './types';
import { registerRevealCommand } from './commands/reveal';
import { registerCopyAddressCommand } from './commands/copyAddress';
import { registerSwitchViewModeCommand } from './commands/switchViewMode';
import { registerShowGraphCommand } from './commands/showGraph';

export function activate(context: vscode.ExtensionContext) {
  // Create the file collector
  const fileCollector = new TerraformFileCollector();

  // Create the file watcher
  const watcher = new TerraformWatcher(fileCollector, {
    debounceMs: 250,
    verbose: true,
    continueOnError: true
  });

  // Create the status bar
  const statusBar = new TerraformStatusBar();

  // Create the graph webview
  const graphWebview = new TerraformGraphWebview(context);

  // Create the tree data provider with watcher
  const treeDataProvider = new TerraformTreeDataProvider(watcher);

  // Register the tree view
  const treeView = vscode.window.createTreeView('tfnavTree', {
    treeDataProvider: treeDataProvider,
    showCollapseAll: true,
  });

  // Wire up status bar events
  watcher.onIndexBuilt((result) => {
    statusBar.setIndexStats(result.index, result.stats.buildTimeMs);
  });

  watcher.onFilesUpdated((event: {files: string[], index: ProjectIndex}) => {
    // For incremental updates, we don't have timing info, so estimate based on file count
    const estimatedTime = event.files.length * 10; // Rough estimate: 10ms per file
    statusBar.setIndexStats(event.index, estimatedTime);
  });

  watcher.onFilesAdded((event: {files: string[], index: ProjectIndex}) => {
    const estimatedTime = event.files.length * 10;
    statusBar.setIndexStats(event.index, estimatedTime);
  });

  watcher.onFilesDeleted((event: {files: string[], index: ProjectIndex}) => {
    const estimatedTime = event.files.length * 5; // Deletion is faster
    statusBar.setIndexStats(event.index, estimatedTime);
  });

  // Start the file watcher
  statusBar.setBuildingState();
  watcher.start().catch(error => {
    console.error('Failed to start Terraform watcher:', error);
    statusBar.clearStats();
    vscode.window.showErrorMessage(`Terraform Navigator: Failed to start file watcher - ${error}`);
  });

  // Register commands
  const refreshCommand = vscode.commands.registerCommand(
    'tfnav.refreshIndex',
    async () => {
      statusBar.setBuildingState();
      await watcher.rebuildIndex();
      // Quietly refresh without intrusive notifications
      console.log('[TerraformNavigator] Index refreshed');
    }
  );

  const revealCommand = registerRevealCommand(context);
  const copyAddressCommand = registerCopyAddressCommand(context);
  const switchViewModeCommand = registerSwitchViewModeCommand(context);
  const showGraphCommand = registerShowGraphCommand(context, graphWebview, () => watcher.getCurrentIndex());

  // Add to subscriptions for cleanup
  context.subscriptions.push(
    treeView,
    refreshCommand,
    revealCommand,
    copyAddressCommand,
    switchViewModeCommand,
    showGraphCommand,
    fileCollector,
    watcher,
    treeDataProvider,
    statusBar,
    graphWebview
  );

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('tfnav')) {
        treeDataProvider.refresh();
      }
    })
  );
}

export function deactivate() {}
