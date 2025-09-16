/**
 * Copy Terraform address command implementation
 */

import * as vscode from 'vscode';
import { TerraformTreeItem } from '../ui/tree';
import { createTerraformAddress } from '../types';

/**
 * Copy the Terraform address to clipboard
 */
export async function copyTerraformAddress(item: TerraformTreeItem): Promise<void> {
  if (!item.address) {
    vscode.window.showErrorMessage('Cannot copy address: No address information available');
    return;
  }

  try {
    // Create the fully-qualified Terraform address
    const address = createTerraformAddress(item.address);
    
    // Copy to clipboard
    await vscode.env.clipboard.writeText(address);
    
    // Show confirmation message
    vscode.window.showInformationMessage(`Copied: ${address}`);
    
  } catch (error) {
    console.error('Error copying address to clipboard:', error);
    vscode.window.showErrorMessage(`Failed to copy address: ${error}`);
  }
}

/**
 * Register the copy address command
 */
export function registerCopyAddressCommand(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand('tfnav.copyAddress', copyTerraformAddress);
}
