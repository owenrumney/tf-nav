/**
 * Webview panel for Terraform dependency graph visualization
 */

import * as vscode from 'vscode';
import { Address, Edge, ProjectIndex } from '../types';
import { getNeighbors, getNeighborsWithDepth, getEdgesForAddress } from './refs';

/**
 * Message types for webview communication
 */
interface WebviewMessage {
  type: 'ready' | 'nodeClick' | 'reveal' | 'refresh' | 'copyAddress' | 'focus' | 'back' | 'forward';
  data?: any;
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

    if (this.panel) {
      // Panel already exists, just reveal it in current column
      this.panel.reveal(vscode.ViewColumn.Active);
      this.updateGraph();
      return;
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
    const usedClusters = new Set<string>();

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
      // Show focus node and its immediate neighbors
      const focusNodeId = this.getNodeId(this.currentFocus);
      
      // Get all nodes we'll be displaying (focus + neighbors)
      const neighbors = getNeighborsWithDepth(this.currentFocus, this.currentIndex.refs, 2);
      
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
      
      console.log(`[GraphWebview] Focus mode: added ${neighbors.length} neighbors and ${edges.length} edges`);
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
        parts.push(`${address.kind}.${address.name}`);
        break;
      case 'data':
        parts.push(`data.${address.kind}.${address.name}`);
        break;
      case 'module':
        parts.push(`module.${address.name}`);
        break;
      case 'variable':
        parts.push(`var.${address.name}`);
        break;
      case 'output':
        parts.push(`output.${address.name}`);
        break;
      case 'locals':
        parts.push(`local.${address.name}`);
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
      case 'resource':
        const resourceInfo = this.getProviderInfo(address.kind);
        label = `${resourceInfo.shortType || 'resource'}.${address.name}`;
        // Use provider color if available, otherwise default to blue
        color = isFocus ? '#e74c3c' : (resourceInfo.color || '#3498db');
        break;
      case 'data':
        const dataInfo = this.getProviderInfo(address.kind);
        label = `${dataInfo.shortType || 'data'}.${address.name}`;
        // Use provider color if available, otherwise default to orange
        color = isFocus ? '#e67e22' : (dataInfo.color || '#f39c12');
        break;
      case 'module':
        label = `${address.name}`;
        color = isFocus ? '#8e44ad' : '#9b59b6'; // Purple for modules
        break;
      case 'variable':
        label = `${address.name}`; // Clean variable name
        color = isFocus ? '#27ae60' : '#2ecc71'; // Green for variables
        break;
      case 'output':
        label = `${address.name}`;
        color = isFocus ? '#16a085' : '#1abc9c'; // Teal for outputs
        break;
      case 'locals':
        // Locals blocks don't have individual names, they're just "locals"
        label = 'locals';
        color = isFocus ? '#c0392b' : '#e74c3c'; // Red for locals
        break;
      default:
        label = address.name || address.blockType;
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
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Terraform Dependency Graph</title>
    <script src="https://unpkg.com/cytoscape@3.26.0/dist/cytoscape.min.js"></script>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        
        #toolbar {
            padding: 10px;
            background-color: var(--vscode-editor-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            gap: 10px;
            align-items: center;
        }
        
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
        }
        
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        button:disabled {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        button:disabled:hover {
            background-color: var(--vscode-button-secondaryBackground);
        }
        
        #cy {
            width: 100%;
            height: calc(100vh - 60px);
            background-color: var(--vscode-editor-background);
        }
        
        .info {
            position: absolute;
            top: 70px;
            right: 10px;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 10px;
            max-width: 250px;
            font-size: 12px;
            z-index: 1000;
        }
        
        .info h3 {
            margin: 0 0 8px 0;
            font-size: 14px;
        }
        
        .info p {
            margin: 4px 0;
        }
        
        /* Context menu styling */
        #context-menu {
            position: absolute;
            background: var(--vscode-menu-background);
            border: 1px solid var(--vscode-menu-border);
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 2000;
            min-width: 180px;
            font-size: 13px;
            padding: 4px 0;
        }
        
        .context-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 12px;
            cursor: pointer;
            color: var(--vscode-menu-foreground);
            transition: background-color 0.1s;
        }
        
        .context-item:hover {
            background-color: var(--vscode-menu-selectionBackground);
            color: var(--vscode-menu-selectionForeground);
        }
        
        .context-item .shortcut {
            font-size: 11px;
            opacity: 0.7;
            font-family: monospace;
        }
    </style>
</head>
<body>
    <div id="toolbar">
        <button id="backBtn" onclick="navigateBack()" disabled>⬅️ Back</button>
        <button id="forwardBtn" onclick="navigateForward()" disabled>➡️ Forward</button>
        <div style="width: 1px; height: 20px; background-color: var(--vscode-panel-border); margin: 0 5px;"></div>
        <button onclick="refreshGraph()">🔄 Refresh</button>
        <button onclick="fitGraph()">🔍 Fit</button>
        <button onclick="resetLayout()">📐 Layout</button>
        <span style="margin-left: auto; font-size: 12px; opacity: 0.7;">
            Click to select • Right-click for menu • Enter to reveal • Ctrl+C to copy
        </span>
    </div>
    
    <div id="cy"></div>
    
    <div id="info" class="info" style="display: none;">
        <h3 id="info-title">Node Info</h3>
        <p><strong>Type:</strong> <span id="info-type"></span></p>
        <p><strong>File:</strong> <span id="info-file"></span></p>
        <p><strong>Module:</strong> <span id="info-module"></span></p>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let cy;
        
        // Smart cluster positioning with improved anti-overlap
        const nodePositions = new Map();
        const minDistance = 120; // Increased minimum distance between nodes for better readability
        
        function getClusterPosition(node) {
            const cluster = node.data('cluster');
            const nodeId = node.data('id');
            
            // If position already calculated, return it
            if (nodePositions.has(nodeId)) {
                return nodePositions.get(nodeId);
            }
            
            // Define cluster centers with better spacing
            const clusterCenters = {
                'variable': { x: -300, y: -200 },
                'resource': { x: 300, y: -200 },
                'data': { x: 300, y: 200 },
                'module': { x: -300, y: 200 },
                'locals': { x: 0, y: -300 },
                'output': { x: 0, y: 300 }
            };
            
            const center = clusterCenters[cluster] || { x: 0, y: 0 };
            const maxAttempts = 100; // More attempts for better positioning
            
            let position;
            let attempts = 0;
            
            do {
                // Try positions in expanding rings around cluster center
                const ring = Math.floor(attempts / 12); // 12 positions per ring for better distribution
                const angleStep = (2 * Math.PI) / 12;
                const angle = (attempts % 12) * angleStep;
                const distance = ring * 60 + 40; // Larger ring steps and base distance
                
                position = {
                    x: center.x + Math.cos(angle) * distance,
                    y: center.y + Math.sin(angle) * distance
                };
                
                attempts++;
                
                // Check if this position conflicts with existing nodes
                if (attempts >= maxAttempts || !hasOverlap(position, nodePositions, minDistance)) {
                    break;
                }
            } while (attempts < maxAttempts);
            
            // Store the calculated position
            nodePositions.set(nodeId, position);
            return position;
        }
        
        function hasOverlap(newPos, existingPositions, minDist) {
            for (const [nodeId, pos] of existingPositions) {
                const dx = newPos.x - pos.x;
                const dy = newPos.y - pos.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < minDist) {
                    return true; // Overlap detected
                }
            }
            return false; // No overlap
        }
        
        function clearPositionCache() {
            nodePositions.clear();
        }

        // Initialize Cytoscape
        document.addEventListener('DOMContentLoaded', function() {
            console.log('[Webview] Initializing Cytoscape...');
            console.log('[Webview] cytoscape available:', typeof window.cytoscape !== 'undefined');
            
            if (typeof window.cytoscape === 'undefined') {
                console.error('[Webview] Cytoscape not loaded!');
                return;
            }
            
            cy = cytoscape({
                container: document.getElementById('cy'),
                
                style: [
                    {
                        selector: 'node',
                        style: {
                            'background-color': 'transparent',
                            'label': 'data(label)',
                            'text-valign': 'center',
                            'text-halign': 'center',
                            'font-size': '11px',
                            'font-weight': 500,
                            'font-family': 'system-ui, -apple-system, sans-serif',
                            'color': 'data(color)',
                            'text-wrap': 'wrap',
                            'text-max-width': '120px',
                            'width': 'label',
                            'height': 'label',
                            'padding': '4px',
                            'shape': 'rectangle',
                            'border-width': 0
                        }
                    },
                    {
                        selector: 'node:hover',
                        style: {
                            'transform': 'scale(1.1)'
                        }
                    },
                    {
                        selector: 'node.selected',
                        style: {
                            'border-width': 2,
                            'border-color': '#007acc',
                            'border-style': 'solid'
                        }
                    },
                    {
                        selector: 'edge',
                        style: {
                            'width': 2,
                            'line-color': 'rgba(150,150,150,0.8)',
                            'target-arrow-color': 'rgba(150,150,150,0.8)',
                            'target-arrow-shape': 'triangle',
                            'target-arrow-size': '8px',
                            'curve-style': 'bezier',
                            'control-point-step-size': 40,
                            'label': 'data(label)',
                            'font-size': '9px',
                            'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                            'text-rotation': 'autorotate',
                            'text-margin-y': -8,
                            'text-background-color': 'rgba(255,255,255,0.9)',
                            'text-background-padding': '2px',
                            'text-background-shape': 'roundrectangle',
                            'color': '#555'
                        }
                    },
                    {
                        selector: 'edge:hover',
                        style: {
                            'width': 3,
                            'line-color': 'rgba(100,100,100,1)',
                            'target-arrow-color': 'rgba(100,100,100,1)'
                        }
                    },
                    {
                        selector: 'node:selected',
                        style: {
                            'border-width': 2,
                            'border-color': '#007acc',
                            'border-style': 'solid',
                            'transform': 'scale(1.15)'
                        }
                    }
                ],
                
                layout: {
                    name: 'preset',
                    positions: function(node) {
                        return getClusterPosition(node);
                    },
                    fit: true,
                    padding: 50
                }
            });
            
            // Event handlers
            let selectedNode = null;
            
            cy.on('tap', 'node', function(evt) {
                const node = evt.target;
                const address = node.data('address');
                
                // Skip cluster nodes
                if (node.data('type') === 'cluster') {
                    return;
                }
                
                // Update selection
                cy.nodes().removeClass('selected');
                node.addClass('selected');
                selectedNode = node;
                
                // Show info panel
                showNodeInfo(node);
                
                // Send click message to extension
                vscode.postMessage({
                    type: 'nodeClick',
                    data: { address }
                });
            });
            
            // Right-click context menu
            cy.on('cxttap', 'node', function(evt) {
                const node = evt.target;
                const address = node.data('address');
                
                // Skip cluster nodes
                if (node.data('type') === 'cluster' || !address) {
                    return;
                }
                
                evt.preventDefault();
                showContextMenu(evt.renderedPosition, address);
            });
            
            // Keyboard shortcuts
            document.addEventListener('keydown', function(evt) {
                if (selectedNode && selectedNode.data('address')) {
                    switch(evt.key) {
                        case 'Enter':
                        case ' ': // Spacebar
                            evt.preventDefault();
                            revealSelectedNode();
                            break;
                        case 'c':
                            if (evt.ctrlKey || evt.metaKey) {
                                evt.preventDefault();
                                copySelectedNodeAddress();
                            }
                            break;
                    }
                }
            });
            
            // Tell extension we're ready
            vscode.postMessage({ type: 'ready' });
        });
        
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'updateGraph':
                    updateGraph(message.data);
                    break;
                    
                case 'navigationState':
                    updateNavigationButtons(message.data);
                    break;
            }
        });
        
        function updateGraph(data) {
            console.log('[Webview] Received graph data:', data);
            console.log('[Webview] Nodes:', data.nodes?.length || 0);
            console.log('[Webview] Edges:', data.edges?.length || 0);
            
            if (cy) {
                // Clear position cache for fresh layout
                clearPositionCache();
                
                const elements = [...(data.nodes || []), ...(data.edges || [])];
                console.log('[Webview] Total elements:', elements.length);
                
                cy.json({ elements });
                cy.layout({ 
                    name: 'preset',
                    positions: function(node) {
                        return getClusterPosition(node);
                    },
                    fit: true,
                    padding: 50
                }).run();
                
                console.log('[Webview] Graph updated, node count:', cy.nodes().length);
            } else {
                console.error('[Webview] Cytoscape instance not available');
            }
        }
        
        function showNodeInfo(node) {
            const address = node.data('address');
            const info = document.getElementById('info');
            
            // Get provider info for resources and data sources
            let providerText = '';
            if (address.blockType === 'resource' || address.blockType === 'data') {
                const kind = address.kind || '';
                // Simple provider detection for display
                if (kind.startsWith('aws_')) providerText = ' (AWS)';
                else if (kind.startsWith('azure') || kind.startsWith('azurerm')) providerText = ' (Azure)';
                else if (kind.startsWith('google_') || kind.startsWith('gcp_')) providerText = ' (GCP)';
                else if (kind.startsWith('kubernetes_') || kind.startsWith('k8s_')) providerText = ' (K8s)';
                else if (kind.startsWith('docker_')) providerText = ' (Docker)';
                else if (kind.startsWith('github_')) providerText = ' (GitHub)';
                else if (kind.startsWith('random_')) providerText = ' (Random)';
            }
            
            document.getElementById('info-title').textContent = node.data('label').replace('\\n', ' ') + providerText;
            document.getElementById('info-type').textContent = address.blockType + (address.kind ? ' (' + address.kind + ')' : '');
            document.getElementById('info-file').textContent = node.data('relativePath') || address.file.split('/').pop();
            document.getElementById('info-module').textContent = address.modulePath.join('.') || 'root';
            
            info.style.display = 'block';
        }
        
        function refreshGraph() {
            vscode.postMessage({ type: 'refresh' });
        }
        
        function fitGraph() {
            if (cy) {
                cy.fit();
            }
        }
        
        function showContextMenu(position, address) {
            hideContextMenu(); // Hide any existing menu
            
            const menu = document.createElement('div');
            menu.id = 'context-menu';
            menu.innerHTML = \`
                <div class="context-item" onclick="revealNode()">
                    <span>📍 Reveal in Editor</span>
                    <span class="shortcut">Enter</span>
                </div>
                <div class="context-item" onclick="copyNodeAddress()">
                    <span>📋 Copy Address</span>
                    <span class="shortcut">Ctrl+C</span>
                </div>
                <div class="context-item" onclick="focusNode()">
                    <span>🎯 Focus Dependencies</span>
                </div>
            \`;
            
            menu.style.left = position.x + 'px';
            menu.style.top = position.y + 'px';
            document.body.appendChild(menu);
            
            // Store address for context actions
            menu.dataset.address = JSON.stringify(address);
            
            // Hide menu when clicking elsewhere
            setTimeout(() => {
                document.addEventListener('click', hideContextMenu, { once: true });
            }, 10);
        }
        
        function hideContextMenu() {
            const menu = document.getElementById('context-menu');
            if (menu) {
                menu.remove();
            }
        }
        
        function revealNode() {
            const menu = document.getElementById('context-menu');
            if (menu && menu.dataset.address) {
                const address = JSON.parse(menu.dataset.address);
                vscode.postMessage({
                    type: 'reveal',
                    data: { address }
                });
                hideContextMenu();
            }
        }
        
        function copyNodeAddress() {
            const menu = document.getElementById('context-menu');
            if (menu && menu.dataset.address) {
                const address = JSON.parse(menu.dataset.address);
                vscode.postMessage({
                    type: 'copyAddress',
                    data: { address }
                });
                hideContextMenu();
            }
        }
        
        function focusNode() {
            const menu = document.getElementById('context-menu');
            if (menu && menu.dataset.address) {
                const address = JSON.parse(menu.dataset.address);
                vscode.postMessage({
                    type: 'focus',
                    data: { address }
                });
                hideContextMenu();
            }
        }
        
        function revealSelectedNode() {
            if (selectedNode && selectedNode.data('address')) {
                vscode.postMessage({
                    type: 'reveal',
                    data: { address: selectedNode.data('address') }
                });
            }
        }
        
        function copySelectedNodeAddress() {
            if (selectedNode && selectedNode.data('address')) {
                vscode.postMessage({
                    type: 'copyAddress',
                    data: { address: selectedNode.data('address') }
                });
            }
        }
        
        function resetLayout() {
            if (cy) {
                // Clear position cache for fresh layout
                clearPositionCache();
                
                cy.layout({ 
                    name: 'preset',
                    positions: function(node) {
                        return getClusterPosition(node);
                    },
                    fit: true,
                    padding: 50
                }).run();
            }
        }
        
        function navigateBack() {
            vscode.postMessage({ type: 'back' });
        }
        
        function navigateForward() {
            vscode.postMessage({ type: 'forward' });
        }
        
        function updateNavigationButtons(state) {
            const backBtn = document.getElementById('backBtn');
            const forwardBtn = document.getElementById('forwardBtn');
            
            if (backBtn) {
                backBtn.disabled = !state.canGoBack;
            }
            if (forwardBtn) {
                forwardBtn.disabled = !state.canGoForward;
            }
        }
        
        // Hide info panel when clicking elsewhere
        document.addEventListener('click', function(e) {
            if (!e.target.closest('#info') && !e.target.closest('#cy')) {
                document.getElementById('info').style.display = 'none';
            }
        });
    </script>
</body>
</html>`;
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
