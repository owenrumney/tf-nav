 
/**
 * Webview panel for Terraform dependency graph visualization
 */

import * as fs from 'fs';
import * as path from 'path';

import * as vscode from 'vscode';

import { Address, Edge, ProjectIndex } from '../types';

import { getNeighborsWithDepth } from './refs';

/**
 * Message data types for webview communication
 */
interface MessageData {
  address?: Address;
  depth?: number;
}

/**
 * Message types for webview communication
 */
interface WebviewMessage {
  type: 'ready' | 'nodeClick' | 'reveal' | 'refresh' | 'copyAddress' | 'focus' | 'back' | 'forward' | 'depthChange';
  data?: MessageData;
}

/**
 * Graph data structure for Cytoscape.js
 */
interface GraphData {
  nodes: Array<{
    data: {
      id: string;
      label: string;
      type: string;
      address?: Address; // Optional for cluster nodes
      color?: string;
      relativePath?: string;
      parent?: string; // For compound node relationships
      cluster?: string; // For position-based clustering
    };
  }>;
  edges: Array<{
    data: {
      id: string;
      source: string;
      target: string;
      label?: string;
      type: string;
    };
  }>;
}

/**
 * Terraform dependency graph webview panel
 */
export class TerraformGraphWebview {
  private panel: vscode.WebviewPanel | null = null;
  private currentIndex: ProjectIndex | null = null;
  private currentFocus: Address | null = null;
  private workspaceRoot: string | null = null;
  private currentDepth: number = 5; // Default depth
  
  // Navigation history
  private navigationHistory: (Address | null)[] = [];
  private currentHistoryIndex: number = -1;

  constructor(private context: vscode.ExtensionContext) {
    // Get workspace root
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      this.workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    }
  }

  /**
   * Get relative path from workspace root
   */
  private getRelativePath(absolutePath: string): string {
    if (!this.workspaceRoot) {
      return absolutePath.split('/').pop() || absolutePath;
    }
    
    if (absolutePath.startsWith(this.workspaceRoot)) {
      return absolutePath.substring(this.workspaceRoot.length + 1);
    }
    
    return absolutePath.split('/').pop() || absolutePath;
  }

  /**
   * Show the graph webview panel
   */
  public async show(index: ProjectIndex, focusAddress?: Address): Promise<void> {
    this.currentIndex = index;
    this.currentFocus = focusAddress || null;

    // Always dispose existing panel to ensure fresh HTML content
    if (this.panel) {
      this.panel.dispose();
      this.panel = null;
    }

    // Create new webview panel in current column as singleton
    this.panel = vscode.window.createWebviewPanel(
      'terraformGraph',
      'Terraform Dependency Graph',
      vscode.ViewColumn.Active, // Use active column instead of beside
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'resources'),
        ],
      }
    );

    // Set up message handling
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleMessage(message),
      undefined,
      this.context.subscriptions
    );

    // Clean up when panel is disposed
    this.panel.onDidDispose(
      () => {
        this.panel = null;
      },
      null,
      this.context.subscriptions
    );

    // Set initial HTML content
    this.panel.webview.html = this.getWebviewContent();
  }

  /**
   * Update the graph with current data
   */
  private updateGraph(): void {
    if (!this.panel || !this.currentIndex) {
      console.log('[GraphWebview] Cannot update graph: missing panel or index');
      return;
    }

    const graphData = this.buildGraphData();
    console.log(`[GraphWebview] Sending graph data: ${graphData.nodes.length} nodes, ${graphData.edges.length} edges`);
    
    this.panel.webview.postMessage({
      type: 'updateGraph',
      data: graphData
    });
  }

  /**
   * Build graph data for the current focus and its neighbors
   */
  private buildGraphData(): GraphData {
    if (!this.currentIndex || !this.currentIndex.refs) {
      console.log('[GraphWebview] No index or refs available');
      return { nodes: [], edges: [] };
    }

    console.log(`[GraphWebview] Building graph data. Index has ${this.currentIndex.blocks.length} blocks, ${this.currentIndex.refs.length} refs`);
    console.log(`[GraphWebview] Focus address: ${this.currentFocus ? this.getNodeId(this.currentFocus) : 'none'}`);

    const nodes: GraphData['nodes'] = [];
    const edges: GraphData['edges'] = [];
    const addedNodes = new Set<string>();

    // If no focus is set, show a sample of the graph
    if (!this.currentFocus) {
      // Show a larger sample to display the many real variable references we now detect
      const resources = this.currentIndex.blocks.filter(addr => addr.blockType === 'resource').slice(0, 8);
      const dataSources = this.currentIndex.blocks.filter(addr => addr.blockType === 'data').slice(0, 4);
      const modules = this.currentIndex.blocks.filter(addr => addr.blockType === 'module').slice(0, 2);
      const variables = this.currentIndex.blocks.filter(addr => addr.blockType === 'variable').slice(0, 15); // Show more variables for real references
      const locals = this.currentIndex.blocks.filter(addr => addr.blockType === 'locals').slice(0, 2);
      
      const sampleBlocks = [...resources, ...dataSources, ...modules, ...variables, ...locals];
      
      console.log(`[GraphWebview] Sample mode: found ${sampleBlocks.length} sample blocks`);
      
      for (const address of sampleBlocks) {
        const nodeId = this.getNodeId(address);
        if (!addedNodes.has(nodeId)) {
          nodes.push(this.createNode(address));
          addedNodes.add(nodeId);
        }
      }
      
      console.log(`[GraphWebview] Added ${nodes.length} sample nodes`);
      
      // Add edges between sample nodes
      for (const edge of this.currentIndex.refs) {
        const sourceId = this.getNodeId(edge.from);
        const targetId = this.getNodeId(edge.to);
        
        if (addedNodes.has(sourceId) && addedNodes.has(targetId)) {
          edges.push(this.createEdge(edge));
          console.log(`[GraphWebview] Added edge: ${sourceId} -> ${targetId}`);
        }
      }
      
      console.log(`[GraphWebview] Added ${edges.length} sample edges`);
      
    } else {
      // Show focus node and its neighbors with current depth
      const focusNodeId = this.getNodeId(this.currentFocus);
      
      // Get all nodes we'll be displaying (focus + neighbors) using current depth
      const neighbors = getNeighborsWithDepth(this.currentFocus, this.currentIndex.refs, this.currentDepth);
      
      // Add focus node
      nodes.push(this.createNode(this.currentFocus, true));
      addedNodes.add(focusNodeId);
      
      // Add neighbor nodes
      for (const neighbor of neighbors) {
        const neighborId = this.getNodeId(neighbor);
        if (!addedNodes.has(neighborId)) {
          nodes.push(this.createNode(neighbor));
          addedNodes.add(neighborId);
        }
      }
      
      // Add all edges between any of the nodes we've included (focus + neighbors)
      for (const edge of this.currentIndex.refs) {
        const sourceId = this.getNodeId(edge.from);
        const targetId = this.getNodeId(edge.to);
        
        // Include edge if both source and target are in our node set
        if (addedNodes.has(sourceId) && addedNodes.has(targetId)) {
          edges.push(this.createEdge(edge));
        }
      }
      
      console.log(`[GraphWebview] Focus mode (depth ${this.currentDepth}): added ${neighbors.length} neighbors and ${edges.length} edges`);
    }

    return { nodes, edges };
  }

  /**
   * Create a unique node ID for an address
   */
  private getNodeId(address: Address): string {
    const parts: string[] = [];
    
    if (address.modulePath.length > 0) {
      parts.push(...address.modulePath);
    }
    
    switch (address.blockType) {
      case 'resource':
        parts.push(`${address.kind || 'unknown'}.${address.name || 'unknown'}`);
        break;
      case 'data':
        parts.push(`data.${address.kind || 'unknown'}.${address.name || 'unknown'}`);
        break;
      case 'module':
        parts.push(`module.${address.name || 'unknown'}`);
        break;
      case 'variable':
        parts.push(`var.${address.name || 'unknown'}`);
        break;
      case 'output':
        parts.push(`output.${address.name || 'unknown'}`);
        break;
      case 'locals':
        parts.push(`local.${address.name || 'unknown'}`);
        break;
    }
    
    return parts.join('.');
  }


  /**
   * Get provider info from resource type
   */
  private getProviderInfo(resourceType?: string): { provider: string; shortType: string; color?: string } {
    if (!resourceType) return { provider: 'unknown', shortType: '' };
    
    // Provider mapping with colors
    const providerMap: Record<string, { name: string; color: string }> = {
      'aws_': { name: 'AWS', color: '#FF9900' },
      'azure_': { name: 'Azure', color: '#0078D4' },
      'azurerm_': { name: 'Azure', color: '#0078D4' },
      'azuread_': { name: 'Azure AD', color: '#0078D4' },
      'google_': { name: 'GCP', color: '#4285F4' },
      'gcp_': { name: 'GCP', color: '#4285F4' },
      'digitalocean_': { name: 'DO', color: '#0080FF' },
      'kubernetes_': { name: 'K8s', color: '#326CE5' },
      'k8s_': { name: 'K8s', color: '#326CE5' },
      'helm_': { name: 'Helm', color: '#0F1689' },
      'docker_': { name: 'Docker', color: '#2496ED' },
      'vault_': { name: 'Vault', color: '#000000' },
      'consul_': { name: 'Consul', color: '#CA2171' },
      'cloudflare_': { name: 'CF', color: '#F38020' },
      'datadog_': { name: 'DD', color: '#632CA6' },
      'github_': { name: 'GitHub', color: '#181717' },
      'gitlab_': { name: 'GitLab', color: '#FC6D26' },
      'random_': { name: 'Random', color: '#95A5A6' },
      'time_': { name: 'Time', color: '#95A5A6' },
      'local_': { name: 'Local', color: '#95A5A6' },
      'null_': { name: 'Null', color: '#95A5A6' }
    };
    
    // Find matching provider
    for (const [prefix, info] of Object.entries(providerMap)) {
      if (resourceType.startsWith(prefix)) {
        const shortened = resourceType.substring(prefix.length);
        return {
          provider: info.name,
          shortType: shortened.length >= 3 ? shortened : resourceType,
          color: info.color
        };
      }
    }
    
    // Unknown provider - keep original
    return { provider: 'Custom', shortType: resourceType };
  }

  /**
   * Shorten resource type by removing common provider prefixes
   */
  private shortenResourceType(resourceType?: string): string {
    return this.getProviderInfo(resourceType).shortType;
  }

  /**
   * Create a graph node from an address
   */
  private createNode(address: Address, isFocus: boolean = false): GraphData['nodes'][0] {
    const id = this.getNodeId(address);
    let label = '';
    let color = '#666';

    switch (address.blockType) {
      case 'resource': {
        const resourceInfo = this.getProviderInfo(address.kind || undefined);
        label = `${address.kind || 'resource'}.${address.name || 'unknown'}`;
        // Use provider color if available, otherwise default to blue
        color = isFocus ? '#e74c3c' : (resourceInfo.color || '#3498db');
        break;
      }
      case 'data': {
        const dataInfo = this.getProviderInfo(address.kind || undefined);
        label = `${address.kind || 'data'}.${address.name || 'unknown'}`;
        // Use provider color if available, otherwise default to orange
        color = isFocus ? '#e67e22' : (dataInfo.color || '#f39c12');
        break;
      }
      case 'module':
        label = `${address.name || 'unknown'}`;
        color = isFocus ? '#8e44ad' : '#9b59b6'; // Purple for modules
        break;
      case 'variable':
        label = `${address.name || 'unknown'}`; // Clean variable name
        color = isFocus ? '#27ae60' : '#2ecc71'; // Green for variables
        break;
      case 'output':
        label = `${address.name || 'unknown'}`;
        color = isFocus ? '#16a085' : '#1abc9c'; // Teal for outputs
        break;
      case 'locals':
        // Locals blocks don't have individual names, they're just "locals"
        label = 'locals';
        color = isFocus ? '#c0392b' : '#e74c3c'; // Red for locals
        break;
      default:
        label = (address.name || address.blockType || 'unknown');
        color = isFocus ? '#34495e' : '#95a5a6'; // Gray for unknown
    }

    return {
      data: {
        id,
        label,
        type: address.blockType,
        address,
        color,
        relativePath: this.getRelativePath(address.file),
        // Add cluster info for positioning but don't use parent relationship
        cluster: address.blockType
      }
    };
  }

  /**
   * Create a cluster container node
   */
  private createClusterNode(clusterId: string, blockType: string): GraphData['nodes'][0] {
    let label = '';
    let color = '#f8f9fa';
    
    switch (blockType) {
      case 'variable':
        label = 'Variables';
        color = '#e8f5e8';
        break;
      case 'resource':
        label = 'Resources';
        color = '#e8f4fd';
        break;
      case 'data':
        label = 'Data Sources';
        color = '#fff3e0';
        break;
      case 'module':
        label = 'Modules';
        color = '#f3e5f5';
        break;
      case 'locals':
        label = 'Locals';
        color = '#ffebee';
        break;
      case 'output':
        label = 'Outputs';
        color = '#e0f2f1';
        break;
      default:
        label = 'Other';
        color = '#f5f5f5';
    }
    
    return {
      data: {
        id: clusterId,
        label,
        type: 'cluster',
        color
      }
    };
  }

  /**
   * Get the cluster group ID for a block type
   */
  private getClusterGroup(blockType: string): string {
    switch (blockType) {
      case 'variable':
        return 'cluster_variables';
      case 'resource':
        return 'cluster_resources';
      case 'data':
        return 'cluster_data';
      case 'module':
        return 'cluster_modules';
      case 'locals':
        return 'cluster_locals';
      case 'output':
        return 'cluster_outputs';
      default:
        return 'cluster_other';
    }
  }

  /**
   * Create a graph edge from an Edge
   */
  private createEdge(edge: Edge): GraphData['edges'][0] {
    const sourceId = this.getNodeId(edge.from);
    const targetId = this.getNodeId(edge.to);
    const edgeId = `${sourceId}->${targetId}`;
    
    // Create descriptive edge label based on target type
    let label = '';
    if (edge.attributes?.referenceType) {
      switch (edge.attributes.referenceType) {
        case 'resource':
          label = edge.attributes.attribute || 'resource';
          break;
        case 'data':
          label = edge.attributes.attribute || 'data';
          break;
        case 'module':
          label = edge.attributes.attribute || 'module';
          break;
        case 'var':
          label = 'variable';
          break;
        case 'local':
          label = 'local';
          break;
        default:
          label = edge.attributes.referenceType;
      }
    } else {
      label = edge.type || 'reference';
    }
    
    return {
      data: {
        id: edgeId,
        source: sourceId,
        target: targetId,
        label: label,
        type: edge.type
      }
    };
  }

  /**
   * Handle messages from the webview
   */
  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        // Webview is ready, send initial data
        this.addToHistory(this.currentFocus);
        this.updateGraph();
        break;

      case 'nodeClick':
        // Node was clicked, potentially change focus
        if (message.data && message.data.address) {
          this.addToHistory(message.data.address);
          this.currentFocus = message.data.address;
          this.updateGraph();
        }
        break;

      case 'reveal':
        // Reveal node in editor
        if (message.data && message.data.address) {
          await this.revealAddressInEditor(message.data.address);
        }
        break;

      case 'refresh':
        // Refresh the graph
        this.updateGraph();
        break;

      case 'copyAddress':
        // Copy address to clipboard
        if (message.data && message.data.address) {
          await this.copyAddressToClipboard(message.data.address);
        }
        break;

      case 'focus':
        // Focus on a specific node's dependencies
        if (message.data && message.data.address) {
          this.addToHistory(message.data.address);
          this.currentFocus = message.data.address;
          this.updateGraph();
        }
        break;

      case 'back':
        // Navigate back in history
        this.navigateBack();
        break;

      case 'forward':
        // Navigate forward in history
        this.navigateForward();
        break;

      case 'depthChange':
        // Change the depth setting
        if (message.data && typeof message.data.depth === 'number') {
          this.currentDepth = message.data.depth;
          console.log(`[GraphWebview] Depth changed to: ${this.currentDepth}`);
          this.updateGraph(); // Refresh graph with new depth
          
          // Send confirmation back to webview
          if (this.panel) {
            this.panel.webview.postMessage({
              type: 'depthChange',
              data: { depth: this.currentDepth }
            });
          }
        }
        break;
    }
  }

  /**
   * Reveal an address in the editor
   */
  private async revealAddressInEditor(address: Address): Promise<void> {
    try {
      // Open the file
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(address.file));
      const editor = await vscode.window.showTextDocument(document);

      // Convert byte offset to position
      const content = document.getText();
      const startText = content.substring(0, address.range.start);
      const startLines = startText.split('\n');
      const startLine = Math.max(0, startLines.length - 1);
      const startChar = startLines[startLine].length;

      const position = new vscode.Position(startLine, startChar);
      
      // Set cursor and reveal
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);

      vscode.window.showInformationMessage(`Revealed ${address.blockType} ${address.name} in editor`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to reveal in editor: ${error}`);
    }
  }

  /**
   * Copy address to clipboard
   */
  private async copyAddressToClipboard(address: Address): Promise<void> {
    try {
      // Create terraform address string
      let addressString = '';
      if (address.modulePath && address.modulePath.length > 0) {
        addressString = address.modulePath.join('.') + '.';
      }
      
      if (address.blockType === 'variable') {
        addressString += `var.${address.name}`;
      } else if (address.blockType === 'locals') {
        // Locals blocks don't have individual names in our current parsing
        // They should ideally be parsed as individual local values
        addressString += 'locals';
      } else if (address.blockType === 'output') {
        addressString += `output.${address.name}`;
      } else if (address.blockType === 'data') {
        addressString += `data.${address.kind}.${address.name}`;
      } else {
        addressString += `${address.kind}.${address.name}`;
      }

      await vscode.env.clipboard.writeText(addressString);
      console.log(`[GraphWebview] Copied address to clipboard: ${addressString}`);
      
    } catch (error) {
      console.error('Error copying address to clipboard:', error);
      vscode.window.showErrorMessage(`Failed to copy address: ${error}`);
    }
  }

  /**
   * Add a new focus state to navigation history
   */
  private addToHistory(focus: Address | null): void {
    // Remove any forward history if we're navigating to a new location
    if (this.currentHistoryIndex < this.navigationHistory.length - 1) {
      this.navigationHistory = this.navigationHistory.slice(0, this.currentHistoryIndex + 1);
    }
    
    // Add the new focus to history (avoid duplicates)
    if (this.navigationHistory.length === 0 || 
        JSON.stringify(this.navigationHistory[this.navigationHistory.length - 1]) !== JSON.stringify(focus)) {
      this.navigationHistory.push(focus);
      this.currentHistoryIndex = this.navigationHistory.length - 1;
    }
    
    // Limit history size to prevent memory issues
    if (this.navigationHistory.length > 50) {
      this.navigationHistory = this.navigationHistory.slice(-50);
      this.currentHistoryIndex = this.navigationHistory.length - 1;
    }
    
    this.updateNavigationButtons();
  }

  /**
   * Navigate back in history
   */
  private navigateBack(): void {
    if (this.currentHistoryIndex > 0) {
      this.currentHistoryIndex--;
      this.currentFocus = this.navigationHistory[this.currentHistoryIndex];
      this.updateGraph();
      this.updateNavigationButtons();
    }
  }

  /**
   * Navigate forward in history
   */
  private navigateForward(): void {
    if (this.currentHistoryIndex < this.navigationHistory.length - 1) {
      this.currentHistoryIndex++;
      this.currentFocus = this.navigationHistory[this.currentHistoryIndex];
      this.updateGraph();
      this.updateNavigationButtons();
    }
  }

  /**
   * Update the state of navigation buttons in the webview
   */
  private updateNavigationButtons(): void {
    if (this.panel) {
      const canGoBack = this.currentHistoryIndex > 0;
      const canGoForward = this.currentHistoryIndex < this.navigationHistory.length - 1;
      
      this.panel.webview.postMessage({
        type: 'navigationState',
        data: { canGoBack, canGoForward }
      });
    }
  }

  /**
   * Generate HTML content for the webview
   */
  private getWebviewContent(): string {
    const htmlPath = path.join(__dirname, 'src', 'graph', 'webview.html');
    console.log('[GraphWebview] Attempting to load webview.html from:', htmlPath);
    try {
      const html = fs.readFileSync(htmlPath, 'utf8');
      console.log('[GraphWebview] Successfully loaded webview.html');
      return html;
    } catch (err) {
      console.error('[GraphWebview] Failed to load webview.html:', err);
      return `<html><body><h2>Error loading webview template</h2><pre>${err}</pre></body></html>`;
    }
  }

  /**
   * Dispose of the webview
   */
  public dispose(): void {
    if (this.panel) {
      this.panel.dispose();
      this.panel = null;
    }
  }
}
