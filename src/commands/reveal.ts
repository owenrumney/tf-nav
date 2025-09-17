/**
 * Reveal command implementation - jumps to Terraform block in editor
 */

import * as fs from 'fs';

import * as vscode from 'vscode';

import { TerraformTreeItem } from '../ui/tree';

/**
 * Convert byte offset to VS Code Position by reading file content
 */
async function byteOffsetToPosition(
  filePath: string,
  byteOffset: number
): Promise<vscode.Position> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');

    // Ensure we don't exceed the content length
    const safeOffset = Math.min(byteOffset, content.length);

    // Get text up to the offset (character-based, not byte-based for UTF-8 safety)
    const textUpToOffset = content.substring(0, safeOffset);

    // Count lines and calculate character position
    const lines = textUpToOffset.split('\n');
    const line = Math.max(0, lines.length - 1);
    const character = lines[line].length;

    return new vscode.Position(line, character);
  } catch (error) {
    console.error('Error converting byte offset to position:', error);
    // Fallback to beginning of file
    return new vscode.Position(0, 0);
  }
}

/**
 * Reveal a Terraform block in the editor
 */
export async function revealInEditor(item: TerraformTreeItem): Promise<void> {
  if (!item.address || !item.resourceUri) {
    vscode.window.showErrorMessage(
      'Cannot reveal: No location information available'
    );
    return;
  }

  try {
    const filePath = item.resourceUri.fsPath;

    // Open the document first
    const document = await vscode.workspace.openTextDocument(item.resourceUri);
    const editor = await vscode.window.showTextDocument(document);

    // Convert character offsets to positions
    const startPosition = await byteOffsetToPosition(
      filePath,
      item.address.range.start
    );
    const endPosition = await byteOffsetToPosition(
      filePath,
      item.address.range.end
    );

    // Validate positions are within document bounds
    const lastLine = document.lineCount - 1;
    const safeStartLine = Math.min(startPosition.line, lastLine);
    const safeEndLine = Math.min(endPosition.line, lastLine);

    const safeStartChar = Math.min(
      startPosition.character,
      document.lineAt(safeStartLine).text.length
    );
    const safeEndChar = Math.min(
      endPosition.character,
      document.lineAt(safeEndLine).text.length
    );

    const safeStartPosition = new vscode.Position(safeStartLine, safeStartChar);
    const safeEndPosition = new vscode.Position(safeEndLine, safeEndChar);

    // Create range for the block
    const range = new vscode.Range(safeStartPosition, safeEndPosition);

    // Set cursor to start of block
    editor.selection = new vscode.Selection(
      safeStartPosition,
      safeStartPosition
    );

    // Reveal the range in center of editor
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

    // Optional: highlight the range briefly
    const decoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor(
        'editor.findMatchHighlightBackground'
      ),
      borderRadius: '2px',
    });

    editor.setDecorations(decoration, [range]);

    // Remove highlight after 2 seconds
    setTimeout(() => {
      decoration.dispose();
    }, 2000);
  } catch (error) {
    console.error('Error revealing in editor:', error);
    vscode.window.showErrorMessage(`Failed to reveal in editor: ${error}`);
  }
}

/**
 * Register the reveal command
 */
export function registerRevealCommand(
  context: vscode.ExtensionContext
): vscode.Disposable {
  return vscode.commands.registerCommand('tfnav.reveal', revealInEditor);
}
