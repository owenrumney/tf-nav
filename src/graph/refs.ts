/**
 * Reference extraction for Terraform dependency graph analysis
 */

import * as fs from 'fs';

import { Address, ProjectIndex, Edge } from '../types';

/**
 * Create an address string for finding targets
 */
function createAddressString(address: Address): string {
  const parts: string[] = [];

  // Add module path
  if (address.modulePath.length > 0) {
    parts.push(...address.modulePath);
  }

  // Add block identifier
  switch (address.blockType) {
    case 'resource':
      if (address.kind && address.name) {
        parts.push(`${address.kind}.${address.name}`);
      }
      break;
    case 'data':
      if (address.kind && address.name) {
        parts.push(`data.${address.kind}.${address.name}`);
      }
      break;
    case 'module':
      if (address.name) {
        parts.push(`module.${address.name}`);
      }
      break;
    case 'variable':
      if (address.name) {
        parts.push(`var.${address.name}`);
      }
      break;
    case 'output':
      if (address.name) {
        parts.push(`${address.name}`);
      }
      break;
    case 'locals':
      if (address.name) {
        parts.push(`local.${address.name}`);
      }
      break;
  }

  return parts.join('.');
}

/**
 * Find target address for a reference
 */
function findTargetAddress(
  reference: {
    type: 'resource' | 'data' | 'module' | 'local' | 'var';
    resourceType?: string;
    resourceName: string;
    attribute?: string;
    modulePath?: string[];
  },
  index: ProjectIndex,
  sourceModulePath: string[]
): Address | null {
  // Build target module path
  const targetModulePath = reference.modulePath || sourceModulePath;

  // Search for matching address
  for (const address of index.blocks) {
    // Check module path match
    if (address.modulePath.length !== targetModulePath.length) {
      continue;
    }

    let modulePathMatch = true;
    for (let i = 0; i < targetModulePath.length; i++) {
      if (address.modulePath[i] !== targetModulePath[i]) {
        modulePathMatch = false;
        break;
      }
    }

    if (!modulePathMatch) {
      continue;
    }

    // Check block type and name match
    switch (reference.type) {
      case 'resource':
        if (
          address.blockType === 'resource' &&
          address.kind === reference.resourceType &&
          address.name === reference.resourceName
        ) {
          return address;
        }
        break;

      case 'data':
        if (
          address.blockType === 'data' &&
          address.kind === reference.resourceType &&
          address.name === reference.resourceName
        ) {
          return address;
        }
        break;

      case 'module':
        if (
          address.blockType === 'module' &&
          address.name === reference.resourceName
        ) {
          return address;
        }
        break;

      case 'var':
        if (
          address.blockType === 'variable' &&
          address.name === reference.resourceName
        ) {
          return address;
        }
        break;

      case 'local':
        if (
          address.blockType === 'locals' &&
          address.name === reference.resourceName
        ) {
          return address;
        }
        break;
    }
  }

  return null;
}

/**
 * Extract variable references from file content using regex
 */
function extractVariableReferencesFromContent(content: string): string[] {
  const variablePattern = /var\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
  const variables = new Set<string>();

  let match;
  while ((match = variablePattern.exec(content)) !== null) {
    variables.add(match[1]);
  }

  return Array.from(variables);
}

/**
 * Extract resource/data references from file content using regex
 */
function extractResourceReferencesFromContent(
  content: string
): Array<{ type: string; name: string }> {
  const resourcePattern =
    /([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\./g;
  const dataPattern =
    /data\.([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
  const references: Array<{ type: string; name: string }> = [];

  // Extract resource references
  let match;
  while ((match = resourcePattern.exec(content)) !== null) {
    const resourceType = match[1];
    const resourceName = match[2];
    // Skip if it looks like a variable (var.something)
    if (
      resourceType !== 'var' &&
      resourceType !== 'local' &&
      resourceType !== 'data'
    ) {
      references.push({ type: resourceType, name: resourceName });
    }
  }

  // Extract data source references
  dataPattern.lastIndex = 0; // Reset regex
  while ((match = dataPattern.exec(content)) !== null) {
    references.push({ type: match[1], name: match[2] });
  }

  return references;
}

/**
 * Extract references from a specific block's content using byte offset ranges
 */
function extractBlockReferences(
  sourceAddress: Address,
  index: ProjectIndex
): Edge[] {
  const edges: Edge[] = [];

  try {
    // Read the actual file content
    const fileContent = fs.readFileSync(sourceAddress.file, 'utf8');

    // Extract only the content for this specific block using byte offsets
    const blockContent = fileContent.substring(
      sourceAddress.range.start,
      sourceAddress.range.end
    );

    console.log(
      `[RefExtraction] Analyzing block ${createAddressString(sourceAddress)} (${blockContent.length} chars)`
    );

    // Extract variable references from this block only
    const variableRefs = extractVariableReferencesFromContent(blockContent);
    for (const varName of variableRefs) {
      const targetAddress = findTargetAddress(
        { type: 'var', resourceName: varName },
        index,
        sourceAddress.modulePath
      );

      if (targetAddress) {
        edges.push({
          from: sourceAddress,
          to: targetAddress,
          type: 'reference',
          attributes: {
            referenceType: 'var',
            attribute: 'variable',
          },
        });
      }
    }

    // Extract resource/data references from this block only
    const resourceRefs = extractResourceReferencesFromContent(blockContent);
    for (const ref of resourceRefs) {
      const targetAddress = findTargetAddress(
        { type: 'resource', resourceType: ref.type, resourceName: ref.name },
        index,
        sourceAddress.modulePath
      );

      if (targetAddress) {
        edges.push({
          from: sourceAddress,
          to: targetAddress,
          type: 'reference',
          attributes: {
            referenceType: 'resource',
            attribute: 'resource',
          },
        });
      }
    }

    // Extract local references from this block only
    const localPattern = /local\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
    let match;
    while ((match = localPattern.exec(blockContent)) !== null) {
      const localName = match[1];
      const targetAddress = findTargetAddress(
        { type: 'local', resourceName: localName },
        index,
        sourceAddress.modulePath
      );

      if (targetAddress) {
        edges.push({
          from: sourceAddress,
          to: targetAddress,
          type: 'reference',
          attributes: {
            referenceType: 'local',
            attribute: 'local',
          },
        });
      }
    }
  } catch (error) {
    console.warn(
      `[RefExtraction] Could not analyze block ${createAddressString(sourceAddress)}: ${error}`
    );
  }

  return edges;
}

/**
 * Extract all dependency edges from a project index using block-scoped HCL content analysis
 */
export function extractReferenceEdges(index: ProjectIndex): Edge[] {
  const edges: Edge[] = [];
  const processedPairs = new Set<string>(); // Avoid duplicate edges

  console.log(
    `[RefExtraction] Starting block-scoped reference extraction for ${index.blocks.length} blocks`
  );

  // First, add module containment edges (module blocks to their internal resources)
  const moduleContainmentEdges = extractModuleContainmentEdges(index);
  for (const edge of moduleContainmentEdges) {
    const edgeKey = `${createAddressString(edge.from)}->${createAddressString(edge.to)}`;
    if (!processedPairs.has(edgeKey)) {
      edges.push(edge);
      processedPairs.add(edgeKey);
    }
  }

  console.log(`[RefExtraction] Added ${moduleContainmentEdges.length} module containment edges`);

  // Second, add module-to-module reference edges (when modules reference other modules)
  const moduleToModuleEdges = extractModuleToModuleEdges(index);
  for (const edge of moduleToModuleEdges) {
    const edgeKey = `${createAddressString(edge.from)}->${createAddressString(edge.to)}`;
    if (!processedPairs.has(edgeKey)) {
      edges.push(edge);
      processedPairs.add(edgeKey);
    }
  }

  console.log(`[RefExtraction] Added ${moduleToModuleEdges.length} module-to-module reference edges`);

  for (const sourceAddress of index.blocks) {
    // Only analyze blocks that can contain references
    if (
      !['resource', 'data', 'module', 'locals'].includes(
        sourceAddress.blockType
      )
    ) {
      continue;
    }

    // Extract references specific to this block
    const blockEdges = extractBlockReferences(sourceAddress, index);

    // Add edges, avoiding duplicates
    for (const edge of blockEdges) {
      const edgeKey = `${createAddressString(edge.from)}->${createAddressString(edge.to)}`;

      if (!processedPairs.has(edgeKey)) {
        edges.push(edge);
        processedPairs.add(edgeKey);
      }
    }
  }

  console.log(
    `[RefExtraction] Extracted ${edges.length} block-scoped reference edges`
  );

  return edges;
}

/**
 * Get all edges for a specific address (both incoming and outgoing)
 */
export function getEdgesForAddress(
  address: Address,
  edges: Edge[]
): {
  incoming: Edge[];
  outgoing: Edge[];
} {
  const addressString = createAddressString(address);

  const incoming = edges.filter(
    (edge) => createAddressString(edge.to) === addressString
  );
  const outgoing = edges.filter(
    (edge) => createAddressString(edge.from) === addressString
  );

  return { incoming, outgoing };
}

/**
 * Get first-degree neighbors of an address
 */
export function getNeighbors(address: Address, edges: Edge[]): Address[] {
  const { incoming, outgoing } = getEdgesForAddress(address, edges);
  const neighbors = new Set<Address>();

  // Add sources of incoming edges
  incoming.forEach((edge) => neighbors.add(edge.from));

  // Add targets of outgoing edges
  outgoing.forEach((edge) => neighbors.add(edge.to));

  return Array.from(neighbors);
}

/**
 * Get neighbors up to N degrees of separation from a given address
 */
export function getNeighborsWithDepth(
  address: Address,
  edges: Edge[],
  depth: number = 2
): Address[] {
  const allNeighbors = new Set<Address>();
  const visited = new Set<string>();
  const queue: { addr: Address; currentDepth: number }[] = [
    { addr: address, currentDepth: 0 },
  ];

  while (queue.length > 0) {
    const { addr, currentDepth } = queue.shift()!;
    const addrKey = createAddressString(addr);

    if (visited.has(addrKey) || currentDepth >= depth) {
      continue;
    }

    visited.add(addrKey);

    // Don't include the original address in the result
    if (currentDepth > 0) {
      allNeighbors.add(addr);
    }

    // Get direct neighbors of current address
    const directNeighbors = getNeighbors(addr, edges);

    // Add them to the queue for the next level
    for (const neighbor of directNeighbors) {
      const neighborKey = createAddressString(neighbor);
      if (!visited.has(neighborKey)) {
        queue.push({ addr: neighbor, currentDepth: currentDepth + 1 });
      }
    }
  }

  console.log(
    `[GraphRefs] Found ${allNeighbors.size} neighbors within ${depth} degrees of ${createAddressString(address)}`
  );

  return Array.from(allNeighbors);
}

/**
 * Extract module containment edges (module blocks -> their internal resources)
 */
function extractModuleContainmentEdges(index: ProjectIndex): Edge[] {
  const edges: Edge[] = [];
  
  // Find all module blocks
  const moduleBlocks = index.blocks.filter(block => block.blockType === 'module');
  
  console.log(`[ModuleContainment] Found ${moduleBlocks.length} module blocks`);
  
  for (const moduleBlock of moduleBlocks) {
    // Find all resources that belong to this module
    const modulePathString = `module.${moduleBlock.name}`;
    
    console.log(`[ModuleContainment] Processing module "${moduleBlock.name}" with source: "${moduleBlock.source}"`);
    
    // Method 1: Check modulePath (standard approach)
    const moduleResourcesByPath = index.blocks.filter(block => 
      block.modulePath.length > 0 && 
      block.modulePath[block.modulePath.length - 1] === modulePathString
    );
    
    // Method 2: Check if modulePath contains the module anywhere
    const moduleResourcesByContains = index.blocks.filter(block => 
      block.modulePath.some(path => path === modulePathString)
    );
    
    // Method 3: File path detection for local modules
    let moduleResourcesByFile: Address[] = [];
    
    // Check if this is a local module (source starts with ./ or ../)
    const isLocalModule = moduleBlock.source && (
      moduleBlock.source.startsWith('./') || 
      moduleBlock.source.startsWith('../')
    );
    
    if (isLocalModule && moduleBlock.source) {
      // For local modules, use file path detection
      console.log(`[ModuleContainment] "${moduleBlock.name}" is a local module, using file path detection`);
      
      // Get the expected directory path from the module source
      let expectedPath = moduleBlock.source;
      if (expectedPath.startsWith('./')) {
        expectedPath = expectedPath.substring(2); // Remove './'
      }
      
      moduleResourcesByFile = index.blocks.filter(block => {
        // Skip the module block itself and blocks without files
        if (block.blockType === 'module' || !block.file) return false;
        
        // Check if the block's file is in the expected module directory
        return block.file.includes(expectedPath);
      });
      
      console.log(`[ModuleContainment] Local module "${moduleBlock.name}" file path detection found ${moduleResourcesByFile.length} resources in path "${expectedPath}"`);
    } else {
      console.log(`[ModuleContainment] "${moduleBlock.name}" is not a local module (source: "${moduleBlock.source}"), skipping file path detection`);
    }
    
    console.log(`[ModuleContainment] Module "${moduleBlock.name}" - Found by modulePath: ${moduleResourcesByPath.length}, by contains: ${moduleResourcesByContains.length}, by file path: ${moduleResourcesByFile.length}`);
    
    // Use the method that finds the most resources, preferring modulePath approach
    let moduleResources: Address[] = [];
    let detectionMethod = '';
    
    if (moduleResourcesByPath.length > 0) {
      moduleResources = moduleResourcesByPath;
      detectionMethod = 'modulePath';
    } else if (moduleResourcesByContains.length > 0) {
      moduleResources = moduleResourcesByContains;
      detectionMethod = 'contains';
    } else if (moduleResourcesByFile.length > 0) {
      moduleResources = moduleResourcesByFile;
      detectionMethod = 'file path';
    }
    
    console.log(`[ModuleContainment] Module "${moduleBlock.name}" contains ${moduleResources.length} resources (using ${detectionMethod} method)`);
    
    // Special debugging for database module
    if (moduleBlock.name === 'database') {
      console.log(`[ModuleContainment] DETAILED DEBUGGING FOR DATABASE MODULE:`);
      console.log(`[ModuleContainment] Database module source: "${moduleBlock.source}"`);
      console.log(`[ModuleContainment] Method 1 (modulePath): Found ${moduleResourcesByPath.length} resources`);
      console.log(`[ModuleContainment] Method 2 (contains): Found ${moduleResourcesByContains.length} resources`);
      console.log(`[ModuleContainment] Method 3 (file path): Found ${moduleResourcesByFile.length} resources`);
      
      // Show which resources were found by file path method
      if (moduleResourcesByFile.length > 0) {
        console.log(`[ModuleContainment] Resources found by file path method:`);
        moduleResourcesByFile.forEach(resource => {
          console.log(`[ModuleContainment]   - ${resource.blockType}.${resource.kind}.${resource.name} from ${resource.file}`);
        });
      }
      
      // Show which files the database module should match
      console.log(`[ModuleContainment] Database module should match files containing: "modules/rds"`);
      const allRdsFiles = index.blocks.filter(block => 
        block.file && block.file.includes('modules/rds') && block.blockType !== 'module'
      );
      console.log(`[ModuleContainment] Found ${allRdsFiles.length} blocks in RDS directory:`);
      allRdsFiles.forEach(block => {
        console.log(`[ModuleContainment]   - ${block.blockType}.${block.kind || ''}.${block.name || ''} in ${block.file}`);
      });
    }
    
    if (moduleResources.length === 0) {
      console.log(`[ModuleContainment] No resources found for module "${moduleBlock.name}". Expected modulePath ending: "${modulePathString}"`);
      console.log(`[ModuleContainment] Module block details - source: "${moduleBlock.source}", file: "${moduleBlock.file}"`);
      
      // Debug: Show ALL blocks that might be related
      console.log(`[ModuleContainment] All blocks in the project:`);
      for (const block of index.blocks) {
        if (block.blockType !== 'module') {
          console.log(`[ModuleContainment] Block: ${block.blockType}.${block.kind || ''}.${block.name || ''}, modulePath: [${block.modulePath.join(', ')}], file: ${block.file}`);
        }
      }
      
      // Special check for database-related blocks
      console.log(`[ModuleContainment] Looking specifically for database-related blocks:`);
      const dbBlocks = index.blocks.filter(block => 
        block.name?.includes('db') || 
        block.name?.includes('database') || 
        block.file?.includes('rds') ||
        block.file?.includes('database')
      );
      for (const block of dbBlocks) {
        console.log(`[ModuleContainment] DB-related block: ${block.blockType}.${block.kind || ''}.${block.name || ''}, modulePath: [${block.modulePath.join(', ')}], file: ${block.file}`);
      }
    }
    
    // Create containment edges from module to each of its resources
    for (const resource of moduleResources) {
      edges.push({
        from: moduleBlock,
        to: resource,
        type: 'contains',
        attributes: {
          referenceType: 'module_containment',
          relationship: 'contains'
        }
      });
      
      console.log(`[ModuleContainment] Added containment edge: ${moduleBlock.blockType}.${moduleBlock.name} -> ${resource.blockType}.${resource.kind}.${resource.name}`);
    }
  }
  
  return edges;
}

/**
 * Extract module-to-module reference edges (when modules reference other modules)
 */
function extractModuleToModuleEdges(index: ProjectIndex): Edge[] {
  const edges: Edge[] = [];
  
  // Find all module blocks
  const moduleBlocks = index.blocks.filter(block => block.blockType === 'module');
  
  console.log(`[ModuleToModule] Found ${moduleBlocks.length} module blocks to analyze for inter-module references`);
  
  for (const sourceModule of moduleBlocks) {
    try {
      // Read the actual file content to extract module references
      const fileContent = fs.readFileSync(sourceModule.file, 'utf8');
      
      // Extract only the content for this specific module block using byte offsets
      const moduleContent = fileContent.substring(
        sourceModule.range.start,
        sourceModule.range.end
      );
      
      // Extract module references from the content (e.g., module.vpc.vpc_id)
      const moduleReferences = extractModuleReferencesFromContent(moduleContent);
      
      console.log(`[ModuleToModule] Module "${sourceModule.name}" references ${moduleReferences.length} other modules`);
      
      // Find target modules and create edges
      for (const moduleRef of moduleReferences) {
        // Find the target module in our index
        const targetModule = index.blocks.find(block => 
          block.blockType === 'module' && 
          block.name === moduleRef.name &&
          // Ensure we're looking for modules in the same scope (same module path level)
          block.modulePath.length === sourceModule.modulePath.length &&
          block.modulePath.every((path, i) => path === sourceModule.modulePath[i])
        );
        
        if (targetModule) {
          edges.push({
            from: sourceModule,
            to: targetModule,
            type: 'reference',
            attributes: {
              referenceType: 'module_reference',
              attribute: moduleRef.attribute,
              relationship: 'uses'
            }
          });
          
          console.log(`[ModuleToModule] Added module reference edge: module.${sourceModule.name} -> module.${targetModule.name} (${moduleRef.attribute})`);
        } else {
          console.log(`[ModuleToModule] Could not find target module "${moduleRef.name}" referenced by module "${sourceModule.name}"`);
        }
      }
    } catch (error) {
      console.warn(`[ModuleToModule] Failed to analyze module "${sourceModule.name}": ${error}`);
    }
  }
  
  return edges;
}

/**
 * Extract module references from content (e.g., module.vpc.vpc_id, module.database.endpoint)
 */
function extractModuleReferencesFromContent(content: string): Array<{ name: string; attribute?: string }> {
  const modulePattern = /module\.([a-zA-Z_][a-zA-Z0-9_]*)(?:\.([a-zA-Z_][a-zA-Z0-9_]*))?/g;
  const references: Array<{ name: string; attribute?: string }> = [];

  let match;
  while ((match = modulePattern.exec(content)) !== null) {
    const moduleName = match[1];
    const attribute = match[2];
    
    references.push({
      name: moduleName,
      attribute: attribute
    });
  }

  return references;
}

/**
 * Helper function to create address string for comparison
 */
