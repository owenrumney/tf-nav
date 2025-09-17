/**
 * Status bar diagnostics for Terraform Navigator
 */

import * as vscode from 'vscode';

import { TerraformParserFactory } from '../indexer/parser';
import { ProjectIndex } from '../types';

export interface IndexStats {
  blockCount: number;
  fileCount: number;
  typeCount: number;
  buildTimeMs: number;
  lastUpdate: Date;
}

/**
 * Manages status bar display for Terraform Navigator
 */
export class TerraformStatusBar {
  private statusBarItem: vscode.StatusBarItem;
  private currentStats: IndexStats | null = null;
  private isBuilding: boolean = false;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = 'tfnav.refreshIndex';
    this.statusBarItem.show();
    this.updateDisplay();
  }

  /**
   * Update status bar when index building starts
   */
  public setBuildingState(): void {
    this.isBuilding = true;
    this.updateDisplay();
  }

  /**
   * Update status bar with completed index stats
   */
  public setIndexStats(index: ProjectIndex, buildTimeMs: number): void {
    this.isBuilding = false;
    this.currentStats = {
      blockCount: index.blocks.length,
      fileCount: index.byFile.size,
      typeCount: index.byType.size,
      buildTimeMs,
      lastUpdate: new Date(),
    };
    this.updateDisplay();
  }

  /**
   * Clear stats (when no workspace or error)
   */
  public clearStats(): void {
    this.isBuilding = false;
    this.currentStats = null;
    this.updateDisplay();
  }

  /**
   * Update the status bar display
   */
  private updateDisplay(): void {
    if (this.isBuilding) {
      this.statusBarItem.text = '$(clock) tf-nav: Building...';
      this.statusBarItem.tooltip = 'Terraform Navigator is building index';
      return;
    }

    if (!this.currentStats) {
      this.statusBarItem.text = '$(warning) tf-nav: No index';
      this.statusBarItem.tooltip =
        'No Terraform index available. Click to refresh.';
      return;
    }

    const stats = this.currentStats;

    // Format build time
    let timeDisplay: string;
    if (stats.buildTimeMs < 1000) {
      timeDisplay = `${stats.buildTimeMs}ms`;
    } else {
      timeDisplay = `${(stats.buildTimeMs / 1000).toFixed(1)}s`;
    }

    // Main status text
    this.statusBarItem.text = `$(database) TF: ${stats.blockCount} blocks in ${timeDisplay}`;

    // Get cache stats
    const cacheStats = TerraformParserFactory.getCacheStats();
    const cacheHitRate = (cacheStats.hitRate * 100).toFixed(1);

    // Detailed tooltip
    const lastUpdateStr = stats.lastUpdate.toLocaleTimeString();
    this.statusBarItem.tooltip = [
      'Terraform Navigator Index',
      '',
      `📊 Blocks: ${stats.blockCount}`,
      `📁 Files: ${stats.fileCount}`,
      `🏷️  Types: ${stats.typeCount}`,
      `⏱️  Build time: ${timeDisplay}`,
      `🕒 Last update: ${lastUpdateStr}`,
      '',
      'Cache Statistics:',
      `💾 Entries: ${cacheStats.totalEntries}`,
      `🎯 Hit rate: ${cacheHitRate}%`,
      `📈 Hits: ${cacheStats.totalHits}`,
      `📉 Misses: ${cacheStats.totalMisses}`,
      '',
      'Click to refresh index',
    ].join('\n');
  }

  /**
   * Get current statistics
   */
  public getStats(): IndexStats | null {
    return this.currentStats;
  }

  /**
   * Check if currently building
   */
  public isBuildingIndex(): boolean {
    return this.isBuilding;
  }

  /**
   * Dispose of status bar item
   */
  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
