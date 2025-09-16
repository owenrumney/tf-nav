/**
 * Reference extraction for Terraform dependency graph analysis
 */

import { Address, ProjectIndex, Edge } from '../types';

/**
 * Reference patterns that indicate dependencies between resources
 */
interface ReferencePattern {
  /** Pattern to match in attribute values */
  pattern: RegExp;
  /** Type of reference this pattern represents */
  type: 'resource' | 'data' | 'module' | 'local' | 'var';
  /** Extract components from a match */
  extract: (match: RegExpMatchArray) => {
    resourceType?: string;
    resourceName?: string;
    modulePath?: string[];
    attribute?: string;
  } | null;
}

/**
 * Known Terraform reference patterns
 */
const TERRAFORM_REFERENCE_PATTERNS: ReferencePattern[] = [
  // Resource references: aws_security_group.web_sg.id
  {
    pattern: /([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*)(?:\.([a-zA-Z_][a-zA-Z0-9_]*))?/g,
    type: 'resource',
    extract: (match) => {
      const fullRef = match[1];
      const attribute = match[2];
      const parts = fullRef.split('.');
      
      if (parts.length === 2) {
        return {
          resourceType: parts[0],
          resourceName: parts[1],
          attribute
        };
      }
      return null;
    }
  },
  
  // Data source references: data.aws_ami.ubuntu.id
  {
    pattern: /data\.([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)(?:\.([a-zA-Z_][a-zA-Z0-9_]*))?/g,
    type: 'data',
    extract: (match) => {
      return {
        resourceType: match[1],
        resourceName: match[2],
        attribute: match[3]
      };
    }
  },
  
  // Module references: module.vpc.vpc_id
  {
    pattern: /module\.([a-zA-Z_][a-zA-Z0-9_]*)(?:\.([a-zA-Z_][a-zA-Z0-9_]*))?/g,
    type: 'module',
    extract: (match) => {
      return {
        resourceName: match[1],
        attribute: match[2]
      };
    }
  },
  
  // Local references: local.common_tags
  {
    pattern: /local\.([a-zA-Z_][a-zA-Z0-9_]*)/g,
    type: 'local',
    extract: (match) => {
      return {
        resourceName: match[1]
      };
    }
  },
  
  // Variable references: var.region
  {
    pattern: /var\.([a-zA-Z_][a-zA-Z0-9_]*)/g,
    type: 'var',
    extract: (match) => {
      return {
        resourceName: match[1]
      };
    }
  }
];

/**
 * Extract all references from a string value (like a resource attribute)
 */
function extractReferencesFromString(value: string): Array<{
  type: 'resource' | 'data' | 'module' | 'local' | 'var';
  resourceType?: string;
  resourceName: string;
  attribute?: string;
  modulePath?: string[];
}> {
  const references: Array<{
    type: 'resource' | 'data' | 'module' | 'local' | 'var';
    resourceType?: string;
    resourceName: string;
    attribute?: string;
    modulePath?: string[];
  }> = [];
  
  for (const pattern of TERRAFORM_REFERENCE_PATTERNS) {
    // Reset regex lastIndex for global patterns
    pattern.pattern.lastIndex = 0;
    
    let match;
    while ((match = pattern.pattern.exec(value)) !== null) {
      const extracted = pattern.extract(match);
      if (extracted && extracted.resourceName) {
        references.push({
          type: pattern.type,
          resourceType: extracted.resourceType,
          resourceName: extracted.resourceName,
          attribute: extracted.attribute,
          modulePath: extracted.modulePath || []
        });
      }
    }
  }
  
  return references;
}

/**
 * Extract references from a complex attribute value (object, array, etc.)
 */
function extractReferencesFromValue(value: any): Array<{
  type: 'resource' | 'data' | 'module' | 'local' | 'var';
  resourceType?: string;
  resourceName: string;
  attribute?: string;
  modulePath?: string[];
}> {
  const references: Array<{
    type: 'resource' | 'data' | 'module' | 'local' | 'var';
    resourceType?: string;
    resourceName: string;
    attribute?: string;
    modulePath?: string[];
  }> = [];
  
  if (typeof value === 'string') {
    references.push(...extractReferencesFromString(value));
  } else if (Array.isArray(value)) {
    for (const item of value) {
      references.push(...extractReferencesFromValue(item));
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, val] of Object.entries(value)) {
      references.push(...extractReferencesFromValue(val));
    }
  }
  
  return references;
}

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
        if (address.blockType === 'resource' &&
            address.kind === reference.resourceType &&
            address.name === reference.resourceName) {
          return address;
        }
        break;
        
      case 'data':
        if (address.blockType === 'data' &&
            address.kind === reference.resourceType &&
            address.name === reference.resourceName) {
          return address;
        }
        break;
        
      case 'module':
        if (address.blockType === 'module' &&
            address.name === reference.resourceName) {
          return address;
        }
        break;
        
      case 'var':
        if (address.blockType === 'variable' &&
            address.name === reference.resourceName) {
          return address;
        }
        break;
        
      case 'local':
        if (address.blockType === 'locals' &&
            address.name === reference.resourceName) {
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
function extractResourceReferencesFromContent(content: string): Array<{type: string, name: string}> {
  const resourcePattern = /([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\./g;
  const dataPattern = /data\.([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
  const references: Array<{type: string, name: string}> = [];
  
  // Extract resource references
  let match;
  while ((match = resourcePattern.exec(content)) !== null) {
    const resourceType = match[1];
    const resourceName = match[2];
    // Skip if it looks like a variable (var.something)
    if (resourceType !== 'var' && resourceType !== 'local' && resourceType !== 'data') {
      references.push({type: resourceType, name: resourceName});
    }
  }
  
  // Extract data source references
  dataPattern.lastIndex = 0; // Reset regex
  while ((match = dataPattern.exec(content)) !== null) {
    references.push({type: match[1], name: match[2]});
  }
  
  return references;
}

/**
 * Extract references from a specific block's content using byte offset ranges
 */
function extractBlockReferences(sourceAddress: Address, index: ProjectIndex): Edge[] {
  const edges: Edge[] = [];
  
  try {
    // Read the actual file content
    const fs = require('fs');
    const fileContent = fs.readFileSync(sourceAddress.file, 'utf8');
    
    // Extract only the content for this specific block using byte offsets
    const blockContent = fileContent.substring(sourceAddress.range.start, sourceAddress.range.end);
    
    console.log(`[RefExtraction] Analyzing block ${createAddressString(sourceAddress)} (${blockContent.length} chars)`);
    
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
            attribute: 'variable'
          }
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
            attribute: 'resource'
          }
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
            attribute: 'local'
          }
        });
      }
    }
    
  } catch (error) {
    console.warn(`[RefExtraction] Could not analyze block ${createAddressString(sourceAddress)}: ${error}`);
  }
  
  return edges;
}

/**
 * Extract all dependency edges from a project index using block-scoped HCL content analysis
 */
export function extractReferenceEdges(index: ProjectIndex): Edge[] {
  const edges: Edge[] = [];
  const processedPairs = new Set<string>(); // Avoid duplicate edges
  
  console.log(`[RefExtraction] Starting block-scoped reference extraction for ${index.blocks.length} blocks`);
  
  for (const sourceAddress of index.blocks) {
    // Only analyze blocks that can contain references
    if (!['resource', 'data', 'module', 'locals'].includes(sourceAddress.blockType)) {
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
  
  console.log(`[RefExtraction] Extracted ${edges.length} block-scoped reference edges`);
  
  return edges;
}

/**
 * Generate simulated references based on common Terraform patterns
 * In a real implementation, this would parse actual HCL attribute expressions
 */
function generateSimulatedReferences(address: Address): Array<{
  type: 'resource' | 'data' | 'module' | 'local' | 'var';
  resourceType?: string;
  resourceName: string;
  attribute?: string;
  modulePath?: string[];
}> {
  const references: Array<{
    type: 'resource' | 'data' | 'module' | 'local' | 'var';
    resourceType?: string;
    resourceName: string;
    attribute?: string;
    modulePath?: string[];
  }> = [];
  
  // Common patterns based on resource types
  if (address.blockType === 'resource' && address.kind) {
    switch (address.kind) {
      case 'aws_instance':
        // EC2 instances typically reference security groups, subnets, AMIs
        references.push(
          { type: 'resource', resourceType: 'aws_security_group', resourceName: 'web', attribute: 'id' },
          { type: 'resource', resourceType: 'aws_subnet', resourceName: 'public', attribute: 'id' },
          { type: 'data', resourceType: 'aws_ami', resourceName: 'ubuntu', attribute: 'id' },
          { type: 'var', resourceName: 'key_name' },
          { type: 'var', resourceName: 'instance_type' }
        );
        break;
        
      case 'aws_security_group':
        // Security groups reference VPCs
        references.push(
          { type: 'resource', resourceType: 'aws_vpc', resourceName: 'main', attribute: 'id' },
          { type: 'var', resourceName: 'vpc_cidr' }
        );
        break;
        
      case 'aws_subnet':
        // Subnets reference VPCs
        references.push(
          { type: 'resource', resourceType: 'aws_vpc', resourceName: 'main', attribute: 'id' },
          { type: 'var', resourceName: 'availability_zones' },
          { type: 'var', resourceName: 'vpc_cidr' }
        );
        break;
        
      case 'aws_db_instance':
        // RDS instances reference security groups and subnet groups
        references.push(
          { type: 'resource', resourceType: 'aws_security_group', resourceName: 'rds', attribute: 'id' },
          { type: 'resource', resourceType: 'aws_db_subnet_group', resourceName: 'main', attribute: 'name' },
          { type: 'var', resourceName: 'database_name' },
          { type: 'var', resourceName: 'database_username' }
        );
        break;
        
      case 'aws_db_subnet_group':
        // DB subnet groups reference subnets
        references.push(
          { type: 'var', resourceName: 'private_subnet_ids' }
        );
        break;
    }
  } else if (address.blockType === 'module') {
    // Modules typically reference various resources and variables
    switch (address.name) {
      case 'database':
        references.push(
          { type: 'resource', resourceType: 'aws_vpc', resourceName: 'main', attribute: 'id' },
          { type: 'resource', resourceType: 'aws_subnet', resourceName: 'private', attribute: 'id' },
          { type: 'var', resourceName: 'database_name' },
          { type: 'var', resourceName: 'database_username' },
          { type: 'var', resourceName: 'database_password' },
          { type: 'local', resourceName: 'common_tags' }
        );
        break;
        
      case 'monitoring':
        references.push(
          { type: 'resource', resourceType: 'aws_instance', resourceName: 'web', attribute: 'id' },
          { type: 'var', resourceName: 'project_name' },
          { type: 'local', resourceName: 'common_tags' }
        );
        break;
    }
  }
  
  return references;
}

/**
 * Get all edges for a specific address (both incoming and outgoing)
 */
export function getEdgesForAddress(address: Address, edges: Edge[]): {
  incoming: Edge[];
  outgoing: Edge[];
} {
  const addressString = createAddressString(address);
  
  const incoming = edges.filter(edge => createAddressString(edge.to) === addressString);
  const outgoing = edges.filter(edge => createAddressString(edge.from) === addressString);
  
  return { incoming, outgoing };
}

/**
 * Get first-degree neighbors of an address
 */
export function getNeighbors(address: Address, edges: Edge[]): Address[] {
  const { incoming, outgoing } = getEdgesForAddress(address, edges);
  const neighbors = new Set<Address>();
  
  // Add sources of incoming edges
  incoming.forEach(edge => neighbors.add(edge.from));
  
  // Add targets of outgoing edges
  outgoing.forEach(edge => neighbors.add(edge.to));
  
  return Array.from(neighbors);
}

/**
 * Get neighbors up to N degrees of separation from a given address
 */
export function getNeighborsWithDepth(address: Address, edges: Edge[], depth: number = 2): Address[] {
  const allNeighbors = new Set<Address>();
  const visited = new Set<string>();
  const queue: { addr: Address; currentDepth: number }[] = [{ addr: address, currentDepth: 0 }];
  
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
  
  console.log(`[GraphRefs] Found ${allNeighbors.size} neighbors within ${depth} degrees of ${createAddressString(address)}`);
  
  return Array.from(allNeighbors);
}
