/**
 * Search command for quickly finding Terraform resources
 */

import * as vscode from 'vscode';

import { Address, ProjectIndex } from '../types';

/**
 * Register the search command
 */
export function registerSearchCommand(
  context: vscode.ExtensionContext,
  getCurrentIndex: () => ProjectIndex | null
): vscode.Disposable {
  return vscode.commands.registerCommand('tfnav.search', async () => {
    const index = getCurrentIndex();
    if (!index || index.blocks.length === 0) {
      vscode.window.showInformationMessage(
        'No Terraform resources found. Try refreshing the index.'
      );
      return;
    }

    // Create quick pick items from all blocks
    const items: TerraformQuickPickItem[] = [];

    for (const block of index.blocks) {
      const item = createQuickPickItem(block);
      if (item) {
        items.push(item);
      }
    }

    if (items.length === 0) {
      vscode.window.showInformationMessage(
        'No searchable Terraform resources found.'
      );
      return;
    }

    // Sort items by label for better UX
    items.sort((a, b) => a.label.localeCompare(b.label));

    // Show quick pick
    const quickPick = vscode.window.createQuickPick<TerraformQuickPickItem>();
    quickPick.placeholder = 'Search Terraform resources, variables, modules...';
    quickPick.items = items;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;

    quickPick.onDidChangeSelection((selection) => {
      if (selection[0]) {
        revealResource(selection[0].address);
        quickPick.hide();
      }
    });

    quickPick.onDidHide(() => quickPick.dispose());
    quickPick.show();
  });
}

/**
 * Quick pick item for Terraform resources
 */
interface TerraformQuickPickItem extends vscode.QuickPickItem {
  address: Address;
}

/**
 * Create a quick pick item from a Terraform block address
 */
function createQuickPickItem(address: Address): TerraformQuickPickItem | null {
  const fileName = require('path').basename(address.file);

  let label: string;
  let description: string;
  let detail: string;
  let icon: string;

  switch (address.blockType) {
    case 'resource':
      icon = '🏗️';
      label = `${address.kind}.${address.name}`;
      description = `${address.kind}`;
      detail = `Resource in ${fileName}`;
      break;

    case 'data':
      icon = '🗄️';
      label = `data.${address.kind}.${address.name}`;
      description = `${address.kind}`;
      detail = `Data source in ${fileName}`;
      break;

    case 'module':
      icon = '📦';
      label = `module.${address.name}`;
      description = 'Module';
      detail = `Module in ${fileName}`;
      break;

    case 'variable':
      icon = '🔧';
      label = `var.${address.name}`;
      description = 'Variable';
      detail = `Variable in ${fileName}`;
      break;

    case 'output':
      icon = '📤';
      label = `output.${address.name}`;
      description = 'Output';
      detail = `Output in ${fileName}`;
      break;

    case 'locals':
      icon = '📍';
      label = 'locals';
      description = 'Locals';
      detail = `Locals block in ${fileName}`;
      break;

    default:
      return null;
  }

  return {
    label: `${icon} ${label}`,
    description,
    detail,
    address,
  };
}

/**
 * Reveal a resource in the editor
 */
async function revealResource(address: Address): Promise<void> {
  try {
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(address.file)
    );
    const editor = await vscode.window.showTextDocument(document);

    // Convert byte offset to position
    const content = document.getText();
    const safeOffset = Math.min(address.range.start, content.length);
    const textUpToOffset = content.substring(0, safeOffset);
    const lines = textUpToOffset.split('\n');
    const line = Math.max(0, lines.length - 1);
    const character = lines[line].length;

    const position = new vscode.Position(line, character);
    const range = new vscode.Range(position, position);

    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  } catch (error) {
    console.error('Error revealing resource:', error);
    vscode.window.showErrorMessage(`Failed to reveal resource: ${error}`);
  }
}
