/**
 * Core types for tf-nav extension based on design.md
 */

/**
 * Terraform block types
 */
export type BlockType = 'resource' | 'data' | 'module' | 'variable' | 'output' | 'locals';

/**
 * Address represents a parsed Terraform block with metadata
 */
export interface Address {
  /** Type of Terraform block */
  blockType: BlockType;
  
  /** Provider name (e.g., "aws" from aws_instance) */
  provider?: string;
  
  /** Resource/data source kind (e.g., "aws_security_group") */
  kind?: string;
  
  /** Block name/identifier */
  name?: string;
  
  /** Module path hierarchy (e.g., ["module.vpc", "module.db"]) */
  modulePath: string[];
  
  /** Absolute file path where block is defined */
  file: string;
  
  /** Byte offset range in file */
  range: {
    start: number;
    end: number;
  };
}

/**
 * Dependency edge between Terraform resources (for v2 graph view)
 */
export interface Edge {
  /** Source terraform address */
  from: string;
  
  /** Target terraform address */
  to: string;
  
  /** Attribute that caused the reference (optional) */
  attr?: string;
}

/**
 * Complete index of a Terraform project
 */
export interface ProjectIndex {
  /** All parsed blocks */
  blocks: Address[];
  
  /** Blocks grouped by type (resource, data, etc.) */
  byType: Map<string, Address[]>;
  
  /** Blocks grouped by file path */
  byFile: Map<string, Address[]>;
  
  /** Dependency edges (for v2 graph functionality) */
  refs?: Edge[];
}

/**
 * Parser result for a single file
 */
export interface ParseResult {
  /** Successfully parsed blocks */
  blocks: Address[];
  
  /** Parse errors encountered */
  errors: ParseError[];
}

/**
 * Parse error information
 */
export interface ParseError {
  /** Error message */
  message: string;
  
  /** File where error occurred */
  file: string;
  
  /** Line number (1-based) */
  line?: number;
  
  /** Column number (1-based) */
  column?: number;
  
  /** Byte offset range where error occurred */
  range?: {
    start: number;
    end: number;
  };
}

/**
 * Raw HCL block structure (internal parsing representation)
 */
export interface HCLBlock {
  type: string;
  labels: string[];
  body: Record<string, any>;
  range: {
    start: number;
    end: number;
  };
}

/**
 * Configuration for parser behavior
 */
export interface ParserConfig {
  /** Include locals blocks in parsing */
  includeLocals?: boolean;
  
  /** Include variable blocks in parsing */
  includeVariables?: boolean;
  
  /** Include output blocks in parsing */
  includeOutputs?: boolean;
  
  /** Include data source blocks in parsing */
  includeDataSources?: boolean;
  
  /** Module path context for nested parsing */
  modulePath?: string[];
  
  /** Whether to use caching (default: true) */
  useCache?: boolean;
}

/**
 * Utility type for Terraform addresses as strings
 */
export type TerraformAddress = string;

/**
 * Helper function to create a Terraform address string
 */
export function createTerraformAddress(address: Address): TerraformAddress {
  const parts: string[] = [];
  
  // Add module path
  if (address.modulePath.length > 0) {
    parts.push(...address.modulePath);
  }
  
  // Add block type and identifiers
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
        parts.push(`output.${address.name}`);
      }
      break;
    case 'locals':
      parts.push('local');
      break;
  }
  
  return parts.join('.');
}

/**
 * Helper function to extract provider from resource kind
 */
export function extractProvider(kind: string): string | undefined {
  const match = kind.match(/^([^_]+)_/);
  return match ? match[1] : undefined;
}
