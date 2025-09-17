/**
 * Switch view mode command implementation
 */

import * as vscode from 'vscode';

/**
 * Switch between 'type' and 'file' view modes
 */
export async function switchViewMode(): Promise<void> {
  try {
    const config = vscode.workspace.getConfiguration('tfnav');
    const currentMode = config.get<string>('viewMode', 'type');

    // Toggle between modes
    const newMode = currentMode === 'type' ? 'file' : 'type';

    // Update configuration
    await config.update(
      'viewMode',
      newMode,
      vscode.ConfigurationTarget.Workspace
    );

    // Show confirmation message
    const modeDescription =
      newMode === 'type'
        ? 'by type (grouped by resource kinds)'
        : 'by file (grouped by files)';
    vscode.window.showInformationMessage(
      `Terraform Navigator: Switched to ${modeDescription}`
    );
  } catch (error) {
    console.error('Error switching view mode:', error);
    vscode.window.showErrorMessage(`Failed to switch view mode: ${error}`);
  }
}

/**
 * Register the switch view mode command
 */
export function registerSwitchViewModeCommand(
  context: vscode.ExtensionContext
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'tfnav.switchViewMode',
    switchViewMode
  );
}
