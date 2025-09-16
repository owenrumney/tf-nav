/**
 * Index builder for Terraform projects
 */

import * as fs from 'fs';
import { Address, ProjectIndex, ParseResult, ParserConfig } from '../types';
import { TerraformParserFactory } from './parser';
import { extractReferenceEdges } from '../graph/refs';

/**
 * Options for building the project index
 */
export interface BuildIndexOptions extends ParserConfig {
  /** Whether to continue parsing on errors */
  continueOnError?: boolean;
  
  /** Maximum number of files to parse (for testing/debugging) */
  maxFiles?: number;
  
  /** Whether to log progress */
  verbose?: boolean;
  
  /** Progress callback for worker threads */
  progressCallback?: (processed: number, total: number, currentFile: string) => void;
}

/**
 * Result of building the project index
 */
export interface BuildIndexResult {
  /** The built project index */
  index: ProjectIndex;
  
  /** Summary statistics */
  stats: {
    /** Total files processed */
    filesProcessed: number;
    
    /** Files with parse errors */
    filesWithErrors: number;
    
    /** Total blocks parsed */
    totalBlocks: number;
    
    /** Blocks by type counts */
    blockTypeCounts: Map<string, number>;
    
    /** Blocks by file counts */
    blockFilesCounts: Map<string, number>;
    
    /** Build time in milliseconds */
    buildTimeMs: number;
    
    /** Build start time */
    buildStartTime: Date;
    
    /** Build end time */
    buildEndTime: Date;
  };
  
  /** All parse errors encountered */
  errors: Array<{
    file: string;
    error: string;
  }>;
}

/**
 * Build a complete project index from a list of Terraform files
 * @param files Array of absolute file paths to parse
 * @param options Build options
 * @returns Build result with index and statistics
 */
export async function buildIndex(files: string[], options: BuildIndexOptions = {}): Promise<BuildIndexResult> {
  const buildStartTime = new Date();
  const buildStartMs = performance.now();
  
  const result: BuildIndexResult = {
    index: {
      blocks: [],
      byType: new Map(),
      byFile: new Map(),
      refs: [] // TODO: Implement dependency analysis in future
    },
    stats: {
      filesProcessed: 0,
      filesWithErrors: 0,
      totalBlocks: 0,
      blockTypeCounts: new Map(),
      blockFilesCounts: new Map(),
      buildTimeMs: 0,
      buildStartTime,
      buildEndTime: buildStartTime // Will be updated at the end
    },
    errors: []
  };

  const filesToProcess = options.maxFiles ? files.slice(0, options.maxFiles) : files;
  
  if (options.verbose) {
    console.log(`Building index for ${filesToProcess.length} files...`);
  }

  // Parse each file
  for (let i = 0; i < filesToProcess.length; i++) {
    const filePath = filesToProcess[i];
    
    try {
      if (options.verbose) {
        console.log(`Parsing: ${filePath}`);
      }

      // Report progress
      if (options.progressCallback) {
        options.progressCallback(i, filesToProcess.length, filePath);
      }

      // Read file content
      const content = await fs.promises.readFile(filePath, 'utf-8');
      
      // Parse the file
      const parseResult = await TerraformParserFactory.parseFile(filePath, content, options);
      
      result.stats.filesProcessed++;
      
      // Handle parse errors
      if (parseResult.errors.length > 0) {
        result.stats.filesWithErrors++;
        
        for (const parseError of parseResult.errors) {
          result.errors.push({
            file: filePath,
            error: parseError.message
          });
        }
        
        if (!options.continueOnError) {
          break;
        }
      }
      
      // Add blocks to the main collection
      result.index.blocks.push(...parseResult.blocks);
      result.stats.totalBlocks += parseResult.blocks.length;
      
      // Update file-specific count
      result.stats.blockFilesCounts.set(filePath, parseResult.blocks.length);
      
      // Update block type counts
      for (const block of parseResult.blocks) {
        const currentCount = result.stats.blockTypeCounts.get(block.blockType) || 0;
        result.stats.blockTypeCounts.set(block.blockType, currentCount + 1);
      }
      
    } catch (error) {
      result.stats.filesWithErrors++;
      result.errors.push({
        file: filePath,
        error: `Failed to process file: ${error}`
      });
      
      if (!options.continueOnError) {
        break;
      }
    }
  }

  // Build organized maps with sorting
  buildOrganizedMaps(result.index);
  
  // Extract reference edges for dependency graph
  result.index.refs = extractReferenceEdges(result.index);
  
  // Calculate final timing
  const buildEndMs = performance.now();
  const buildEndTime = new Date();
  result.stats.buildTimeMs = Math.round(buildEndMs - buildStartMs);
  result.stats.buildEndTime = buildEndTime;
  
  // Final progress report
  if (options.progressCallback) {
    options.progressCallback(filesToProcess.length, filesToProcess.length, 'Complete');
  }
  
  if (options.verbose) {
    console.log(`Index built: ${result.stats.totalBlocks} blocks from ${result.stats.filesProcessed} files`);
    console.log('Block type distribution:', Object.fromEntries(result.stats.blockTypeCounts));
    console.log(`Build time: ${result.stats.buildTimeMs}ms`);
    console.log(`Reference edges: ${result.index.refs?.length || 0}`);
  }

  return result;
}

/**
 * Build the byType and byFile maps with proper sorting
 * @param index The project index to populate
 */
function buildOrganizedMaps(index: ProjectIndex): void {
  // Clear existing maps
  index.byType.clear();
  index.byFile.clear();
  
  // Group blocks by type
  const typeGroups = new Map<string, Address[]>();
  for (const block of index.blocks) {
    const blocks = typeGroups.get(block.blockType) || [];
    blocks.push(block);
    typeGroups.set(block.blockType, blocks);
  }
  
  // Sort by resource name within each type and populate byType map
  for (const [blockType, blocks] of typeGroups.entries()) {
    const sortedBlocks = blocks.sort((a, b) => {
      // Primary sort: by name (if available)
      const nameA = a.name || '';
      const nameB = b.name || '';
      
      if (nameA !== nameB) {
        return nameA.localeCompare(nameB);
      }
      
      // Secondary sort: by kind (for resources/data sources)
      const kindA = a.kind || '';
      const kindB = b.kind || '';
      
      if (kindA !== kindB) {
        return kindA.localeCompare(kindB);
      }
      
      // Tertiary sort: by file path
      return a.file.localeCompare(b.file);
    });
    
    index.byType.set(blockType, sortedBlocks);
  }
  
  // Group blocks by file
  const fileGroups = new Map<string, Address[]>();
  for (const block of index.blocks) {
    const blocks = fileGroups.get(block.file) || [];
    blocks.push(block);
    fileGroups.set(block.file, blocks);
  }
  
  // Sort by range within each file and populate byFile map
  for (const [filePath, blocks] of fileGroups.entries()) {
    const sortedBlocks = blocks.sort((a, b) => {
      // Primary sort: by start position
      if (a.range.start !== b.range.start) {
        return a.range.start - b.range.start;
      }
      
      // Secondary sort: by end position (smaller ranges first)
      return a.range.end - b.range.end;
    });
    
    index.byFile.set(filePath, sortedBlocks);
  }
}

/**
 * Helper function to get block type counts from an index
 * @param index The project index
 * @returns Map of block type to count
 */
export function getBlockTypeCounts(index: ProjectIndex): Map<string, number> {
  const counts = new Map<string, number>();
  
  for (const [blockType, blocks] of index.byType.entries()) {
    counts.set(blockType, blocks.length);
  }
  
  return counts;
}

/**
 * Helper function to get file block counts from an index
 * @param index The project index
 * @returns Map of file path to block count
 */
export function getFileBlockCounts(index: ProjectIndex): Map<string, number> {
  const counts = new Map<string, number>();
  
  for (const [filePath, blocks] of index.byFile.entries()) {
    counts.set(filePath, blocks.length);
  }
  
  return counts;
}

/**
 * Helper function to create a summary report of the index
 * @param index The project index
 * @returns Human-readable summary
 */
export function createIndexSummary(index: ProjectIndex): string {
  const lines: string[] = [];
  
  lines.push(`Total blocks: ${index.blocks.length}`);
  lines.push('');
  
  // Block type summary
  lines.push('Blocks by type:');
  const typeCounts = getBlockTypeCounts(index);
  for (const [blockType, count] of Array.from(typeCounts.entries()).sort()) {
    lines.push(`  ${blockType}: ${count}`);
  }
  lines.push('');
  
  // File summary
  lines.push('Blocks by file:');
  const fileCounts = getFileBlockCounts(index);
  for (const [filePath, count] of Array.from(fileCounts.entries()).sort()) {
    const fileName = filePath.split('/').pop() || filePath;
    lines.push(`  ${fileName}: ${count}`);
  }
  
  return lines.join('\n');
}

/**
 * Helper function to find blocks by criteria
 * @param index The project index
 * @param criteria Search criteria
 * @returns Matching blocks
 */
export function findBlocks(index: ProjectIndex, criteria: {
  blockType?: string;
  provider?: string;
  kind?: string;
  name?: string;
  file?: string;
}): Address[] {
  let blocks = index.blocks;
  
  if (criteria.blockType) {
    blocks = blocks.filter(b => b.blockType === criteria.blockType);
  }
  
  if (criteria.provider) {
    blocks = blocks.filter(b => b.provider === criteria.provider);
  }
  
  if (criteria.kind) {
    blocks = blocks.filter(b => b.kind === criteria.kind);
  }
  
  if (criteria.name) {
    blocks = blocks.filter(b => b.name === criteria.name);
  }
  
  if (criteria.file) {
    blocks = blocks.filter(b => b.file === criteria.file);
  }
  
  return blocks;
}
