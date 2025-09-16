/**
 * Show graph command implementation - opens dependency graph webview
 */

import * as vscode from 'vscode';
import { TerraformTreeItem } from '../ui/tree';
import { TerraformGraphWebview } from '../graph/webview';
import { ProjectIndex } from '../types';

/**
 * Show the dependency graph for the current workspace
 */
export async function showGraph(
  context: vscode.ExtensionContext,
  graphWebview: TerraformGraphWebview,
  index: ProjectIndex | null,
  focusItem?: TerraformTreeItem
): Promise<void> {
  
  if (!index) {
    vscode.window.showWarningMessage('No Terraform index available. Please wait for indexing to complete.');
    return;
  }

  if (!index.refs || index.refs.length === 0) {
    vscode.window.showInformationMessage('No dependencies found in the current workspace.');
    return;
  }

  try {
    // Determine focus address from tree item if provided
    const focusAddress = focusItem?.address || undefined;
    
    // Show the graph webview
    await graphWebview.show(index, focusAddress);
    
    // Show success message
    const focusMsg = focusAddress 
      ? ` focusing on ${focusAddress.blockType} ${focusAddress.name}`
      : '';
    
    // Quietly open the graph without intrusive notifications
    console.log(`[ShowGraph] Opened dependency graph${focusMsg} - ${index.refs.length} dependencies found`);
    
  } catch (error) {
    console.error('Error showing graph:', error);
    vscode.window.showErrorMessage(`Failed to show dependency graph: ${error}`);
  }
}

/**
 * Register the show graph command
 */
export function registerShowGraphCommand(
  context: vscode.ExtensionContext, 
  graphWebview: TerraformGraphWebview,
  getCurrentIndex: () => ProjectIndex | null
): vscode.Disposable {
  
  return vscode.commands.registerCommand('tfnav.showGraph', async (treeItem?: TerraformTreeItem) => {
    const currentIndex = getCurrentIndex();
    await showGraph(context, graphWebview, currentIndex, treeItem);
  });
}
