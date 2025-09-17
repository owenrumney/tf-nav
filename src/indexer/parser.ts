/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Terraform file parser interface and implementations
 */

import * as path from 'path';

import {
  Address,
  ParseResult,
  ParserConfig,
  BlockType,
  extractProvider,
} from '../types';

import { TerraformParseCache } from './cache';

/**
 * Interface for parsing Terraform files
 */
export interface TerraformParser {
  /**
   * Parse a Terraform file and extract block metadata
   * @param filePath Absolute path to the file
   * @param content File content as string
   * @param config Parser configuration options
   * @returns Parse result with blocks and errors
   */
  parseFile(
    filePath: string,
    content: string,
    config?: ParserConfig
  ): Promise<ParseResult>;

  /**
   * Check if this parser can handle the given file
   * @param filePath File path to check
   * @returns True if parser can handle this file type
   */
  canParse(filePath: string): boolean;
}

/**
 * Default HCL2 parser implementation using hcl2-parser library
 */
export class HCL2Parser implements TerraformParser {
  private hclParser: any;

  constructor() {
    try {
      // Dynamic import of hcl2-parser
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.hclParser = require('hcl2-parser');
    } catch (error) {
      throw new Error(`Failed to load HCL parser: ${error}`);
    }
  }

  canParse(filePath: string): boolean {
    return filePath.endsWith('.tf') || filePath.endsWith('.tf.json');
  }

  async parseFile(
    filePath: string,
    content: string,
    config: ParserConfig = {}
  ): Promise<ParseResult> {
    const result: ParseResult = {
      blocks: [],
      errors: [],
    };

    try {
      if (filePath.endsWith('.tf.json')) {
        return this.parseJsonFile(filePath, content, config);
      } else {
        return this.parseHCLFile(filePath, content, config);
      }
    } catch (error) {
      result.errors.push({
        message: `Failed to parse file: ${error}`,
        file: filePath,
      });
      return result;
    }
  }

  private async parseHCLFile(
    filePath: string,
    content: string,
    config: ParserConfig
  ): Promise<ParseResult> {
    const result: ParseResult = {
      blocks: [],
      errors: [],
    };

    try {
      // Parse HCL content - hcl2-parser returns [parsedContent, errors]
      const parseResult = this.hclParser.parseToObject(content);

      if (!parseResult || !Array.isArray(parseResult)) {
        result.errors.push({
          message: 'Failed to parse HCL content',
          file: filePath,
        });
        return result;
      }

      const [parsed, parseErrors] = parseResult;

      if (parseErrors) {
        result.errors.push({
          message: `HCL parse errors: ${parseErrors}`,
          file: filePath,
        });
      }

      if (!parsed || typeof parsed !== 'object') {
        result.errors.push({
          message: 'No valid HCL content found',
          file: filePath,
        });
        return result;
      }

      // Extract blocks from parsed content
      result.blocks = this.extractBlocksFromHCL(
        parsed,
        filePath,
        content,
        config
      );
    } catch (error) {
      result.errors.push({
        message: `HCL parsing error: ${error}`,
        file: filePath,
      });
    }

    return result;
  }

  private async parseJsonFile(
    filePath: string,
    content: string,
    config: ParserConfig
  ): Promise<ParseResult> {
    const result: ParseResult = {
      blocks: [],
      errors: [],
    };

    try {
      const parsed = JSON.parse(content);
      result.blocks = this.extractBlocksFromJSON(
        parsed,
        filePath,
        content,
        config
      );
    } catch (error) {
      result.errors.push({
        message: `JSON parsing error: ${error}`,
        file: filePath,
      });
    }

    return result;
  }

  private extractBlocksFromHCL(
    parsed: Record<string, unknown>,
    filePath: string,
    content: string,
    config: ParserConfig
  ): Address[] {
    const blocks: Address[] = [];
    const modulePath = config.modulePath || [];

    // Extract resource blocks
    if (parsed.resource) {
      for (const [resourceType, resources] of Object.entries(parsed.resource)) {
        if (typeof resources === 'object' && resources !== null) {
          for (const [resourceName, resourceConfigArray] of Object.entries(
            resources as Record<string, any>
          )) {
            // hcl2-parser returns arrays for each resource
            if (
              Array.isArray(resourceConfigArray) &&
              resourceConfigArray.length > 0
            ) {
              blocks.push(
                this.createAddress({
                  blockType: 'resource',
                  kind: resourceType,
                  name: resourceName,
                  provider: extractProvider(resourceType),
                  modulePath,
                  file: filePath,
                  range: this.estimateRange(
                    content,
                    'resource',
                    resourceName,
                    resourceType
                  ),
                })
              );
            }
          }
        }
      }
    }

    // Extract data source blocks
    if (parsed.data && config.includeDataSources !== false) {
      for (const [dataType, dataSources] of Object.entries(parsed.data)) {
        if (typeof dataSources === 'object' && dataSources !== null) {
          for (const [dataName, dataConfigArray] of Object.entries(
            dataSources as Record<string, any>
          )) {
            if (Array.isArray(dataConfigArray) && dataConfigArray.length > 0) {
              blocks.push(
                this.createAddress({
                  blockType: 'data',
                  kind: dataType,
                  name: dataName,
                  provider: extractProvider(dataType),
                  modulePath,
                  file: filePath,
                  range: this.estimateRange(
                    content,
                    'data',
                    dataName,
                    dataType
                  ),
                })
              );
            }
          }
        }
      }
    }

    // Extract module blocks
    if (parsed.module) {
      for (const [moduleName, moduleConfigArray] of Object.entries(
        parsed.module
      )) {
        if (Array.isArray(moduleConfigArray) && moduleConfigArray.length > 0) {
          // Extract source from module configuration
          let source: string | undefined;
          const moduleConfig = moduleConfigArray[0];
          if (moduleConfig && typeof moduleConfig === 'object' && moduleConfig !== null && 'source' in moduleConfig) {
            const configObj = moduleConfig as Record<string, unknown>;
            if (typeof configObj.source === 'string') {
              source = configObj.source;
            }
          }

          blocks.push(
            this.createAddress({
              blockType: 'module',
              name: moduleName,
              source,
              modulePath,
              file: filePath,
              range: this.estimateRange(content, 'module', moduleName),
            })
          );
        }
      }
    }

    // Extract variable blocks
    if (parsed.variable && config.includeVariables !== false) {
      for (const [variableName, variableConfigArray] of Object.entries(
        parsed.variable
      )) {
        if (
          Array.isArray(variableConfigArray) &&
          variableConfigArray.length > 0
        ) {
          blocks.push(
            this.createAddress({
              blockType: 'variable',
              name: variableName,
              modulePath,
              file: filePath,
              range: this.estimateRange(content, 'variable', variableName),
            })
          );
        }
      }
    }

    // Extract output blocks
    if (parsed.output && config.includeOutputs !== false) {
      for (const [outputName, outputConfigArray] of Object.entries(
        parsed.output
      )) {
        if (Array.isArray(outputConfigArray) && outputConfigArray.length > 0) {
          blocks.push(
            this.createAddress({
              blockType: 'output',
              name: outputName,
              modulePath,
              file: filePath,
              range: this.estimateRange(content, 'output', outputName),
            })
          );
        }
      }
    }

    // Extract locals blocks
    if (parsed.locals && config.includeLocals !== false) {
      // locals is typically an array of objects
      if (Array.isArray(parsed.locals) && parsed.locals.length > 0) {
        blocks.push(
          this.createAddress({
            blockType: 'locals',
            modulePath,
            file: filePath,
            range: this.estimateRange(content, 'locals'),
          })
        );
      }
    }

    return blocks;
  }

  private extractBlocksFromJSON(
    parsed: any,
    filePath: string,
    content: string,
    config: ParserConfig
  ): Address[] {
    const blocks: Address[] = [];
    const modulePath = config.modulePath || [];

    // JSON format doesn't use arrays like HCL parser does, so handle it directly

    // Extract resource blocks
    if (parsed.resource) {
      for (const [resourceType, resources] of Object.entries(parsed.resource)) {
        if (typeof resources === 'object' && resources !== null) {
          for (const [resourceName] of Object.entries(
            resources as Record<string, unknown>
          )) {
            blocks.push(
              this.createAddress({
                blockType: 'resource',
                kind: resourceType,
                name: resourceName,
                provider: extractProvider(resourceType),
                modulePath,
                file: filePath,
                range: this.estimateRange(content, resourceType, resourceName),
              })
            );
          }
        }
      }
    }

    // Extract data source blocks
    if (parsed.data && config.includeDataSources !== false) {
      for (const [dataType, dataSources] of Object.entries(parsed.data)) {
        if (typeof dataSources === 'object' && dataSources !== null) {
          for (const [dataName] of Object.entries(
            dataSources as Record<string, unknown>
          )) {
            blocks.push(
              this.createAddress({
                blockType: 'data',
                kind: dataType,
                name: dataName,
                provider: extractProvider(dataType),
                modulePath,
                file: filePath,
                range: this.estimateRange(content, dataType, dataName),
              })
            );
          }
        }
      }
    }

    // Extract module blocks
    if (parsed.module) {
      for (const [moduleName, moduleConfig] of Object.entries(parsed.module)) {
        // Extract source from module configuration
        let source: string | undefined;
        if (moduleConfig && typeof moduleConfig === 'object' && moduleConfig !== null && 'source' in moduleConfig) {
          const configObj = moduleConfig as Record<string, unknown>;
          if (typeof configObj.source === 'string') {
            source = configObj.source;
          }
        }

        blocks.push(
          this.createAddress({
            blockType: 'module',
            name: moduleName,
            source,
            modulePath,
            file: filePath,
            range: this.estimateRange(content, 'module', moduleName),
          })
        );
      }
    }

    // Extract variable blocks
    if (parsed.variable && config.includeVariables !== false) {
      for (const [variableName] of Object.entries(
        parsed.variable
      )) {
        blocks.push(
          this.createAddress({
            blockType: 'variable',
            name: variableName,
            modulePath,
            file: filePath,
            range: this.estimateRange(content, 'variable', variableName),
          })
        );
      }
    }

    // Extract output blocks
    if (parsed.output && config.includeOutputs !== false) {
      for (const [outputName] of Object.entries(parsed.output)) {
        blocks.push(
          this.createAddress({
            blockType: 'output',
            name: outputName,
            modulePath,
            file: filePath,
            range: this.estimateRange(content, 'output', outputName),
          })
        );
      }
    }

    // Extract locals blocks
    if (parsed.locals && config.includeLocals !== false) {
      blocks.push(
        this.createAddress({
          blockType: 'locals',
          modulePath,
          file: filePath,
          range: this.estimateRange(content, 'locals'),
        })
      );
    }

    return blocks;
  }

  private createAddress(params: {
    blockType: BlockType;
    kind?: string;
    name?: string;
    provider?: string;
    source?: string;
    modulePath: string[];
    file: string;
    range: { start: number; end: number };
  }): Address {
    return {
      blockType: params.blockType,
      kind: params.kind,
      name: params.name,
      provider: params.provider,
      source: params.source,
      modulePath: [...params.modulePath],
      file: params.file,
      range: params.range,
    };
  }

  private estimateRange(
    content: string,
    blockType: string,
    blockName?: string,
    resourceType?: string
  ): { start: number; end: number } {
    // This is a simplified range estimation
    // In a production implementation, you'd want more accurate position tracking

    let searchPattern: string;
    if (blockType === 'resource' || blockType === 'data') {
      // For resource and data blocks: resource "type" "name" or data "type" "name"
      if (blockName && resourceType) {
        // Use specific resource type for more accurate matching
        searchPattern = `${blockType}\\s+"${resourceType}"\\s+"${blockName}"`;
      } else if (blockName) {
        // Fallback to generic pattern
        searchPattern = `${blockType}\\s+"[^"]*"\\s+"${blockName}"`;
      } else {
        searchPattern = `${blockType}\\s+"[^"]*"\\s*{`;
      }
    } else if (blockType === 'module') {
      // For module blocks: module "name"
      if (blockName) {
        searchPattern = `${blockType}\\s+"${blockName}"`;
      } else {
        searchPattern = `${blockType}\\s+"[^"]*"\\s*{`;
      }
    } else if (blockType === 'provider') {
      // For provider blocks: provider "name" or provider
      if (blockName) {
        searchPattern = `${blockType}\\s+"${blockName}"\\s*{`;
      } else {
        searchPattern = `${blockType}\\s*{`;
      }
    } else {
      // For other blocks like variable, output, locals: variable "name"
      if (blockName) {
        searchPattern = `${blockType}\\s+"${blockName}"`;
      } else {
        searchPattern = `${blockType}\\s*{`;
      }
    }

    const regex = new RegExp(searchPattern, 'i');
    const match = content.match(regex);

    if (match && match.index !== undefined) {
      const start = match.index;
      // Estimate end by finding the closing brace
      let braceCount = 0;
      let end = start;
      let inString = false;
      let escapeNext = false;

      for (let i = start; i < content.length; i++) {
        const char = content[i];

        if (escapeNext) {
          escapeNext = false;
          continue;
        }

        if (char === '\\') {
          escapeNext = true;
          continue;
        }

        if (char === '"' && !escapeNext) {
          inString = !inString;
          continue;
        }

        if (!inString) {
          if (char === '{') {
            braceCount++;
          } else if (char === '}') {
            braceCount--;
            if (braceCount === 0) {
              end = i + 1;
              break;
            }
          }
        }
      }

      return { start, end };
    }

    // Fallback: return beginning of content
    return { start: 0, end: Math.min(100, content.length) };
  }
}

/**
 * Parser factory to create appropriate parser for file type
 */
export class TerraformParserFactory {
  private static parsers: TerraformParser[] = [new HCL2Parser()];

  private static cache = new TerraformParseCache({
    maxEntries: 1000,
    maxAgeMs: 10 * 60 * 1000, // 10 minutes
    verbose: false,
  });

  /**
   * Get appropriate parser for the given file
   * @param filePath File path to parse
   * @returns Parser instance or null if no suitable parser found
   */
  static getParser(filePath: string): TerraformParser | null {
    for (const parser of this.parsers) {
      if (parser.canParse(filePath)) {
        return parser;
      }
    }
    return null;
  }

  /**
   * Parse a file using the appropriate parser with caching
   * @param filePath Absolute path to file
   * @param content File content
   * @param config Parser configuration
   * @returns Parse result
   */
  static async parseFile(
    filePath: string,
    content: string,
    config?: ParserConfig
  ): Promise<ParseResult> {
    // Check cache first (unless caching is disabled)
    if (config?.useCache !== false) {
      const cachedResult = await this.cache.get(filePath);
      if (cachedResult) {
        return cachedResult;
      }
    }

    const parser = this.getParser(filePath);

    if (!parser) {
      return {
        blocks: [],
        errors: [
          {
            message: `No suitable parser found for file: ${path.basename(filePath)}`,
            file: filePath,
          },
        ],
      };
    }

    const result = await parser.parseFile(filePath, content, config);

    // Cache the result (unless caching is disabled)
    if (config?.useCache !== false) {
      await this.cache.set(filePath, result);
    }

    return result;
  }

  /**
   * Get cache statistics
   */
  static getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Clear the parse cache
   */
  static clearCache(): void {
    this.cache.clear();
  }

  /**
   * Evict a specific file from cache
   */
  static evictFromCache(filePath: string): boolean {
    return this.cache.evict(filePath);
  }
}
