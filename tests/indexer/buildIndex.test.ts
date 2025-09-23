// Tests for buildIndex functionality
import {
  buildIndex,
  getBlockTypeCounts,
  getFileBlockCounts,
  createIndexSummary,
  findBlocks,
} from '../../src/indexer/buildIndex';
import { createTestWorkspaceHelper } from '../test-utils';
import * as path from 'path';

describe('buildIndex', () => {
  const testWorkspace = createTestWorkspaceHelper();

  beforeAll(() => {
    const validation = testWorkspace.validateWorkspace();
    if (!validation.isValid) {
      throw new Error(
        `Test workspace validation failed: ${validation.errors.join(', ')}`
      );
    }
  });

  describe('buildIndex function', () => {
    it('should build index from test workspace files', async () => {
      const terraformFiles = testWorkspace
        .getExpectedTerraformFiles()
        .map((relativePath) =>
          path.join(testWorkspace.workspace, relativePath)
        );

      const result = await buildIndex(terraformFiles, { verbose: false });

      expect(result.index).toBeDefined();
      expect(result.stats).toBeDefined();
      expect(result.errors).toBeDefined();

      // Should have processed all files
      expect(result.stats.filesProcessed).toBe(terraformFiles.length);
      expect(result.stats.totalBlocks).toBeGreaterThan(0);

      // Should have organized maps
      expect(result.index.byType.size).toBeGreaterThan(0);
      expect(result.index.byFile.size).toBeGreaterThan(0);
    });

    it('should build index and report counts by block type', async () => {
      const terraformFiles = testWorkspace
        .getExpectedTerraformFiles()
        .map((relativePath) =>
          path.join(testWorkspace.workspace, relativePath)
        );

      const result = await buildIndex(terraformFiles);

      // Verify block type counts
      const blockTypeCounts = result.stats.blockTypeCounts;
      expect(blockTypeCounts.size).toBeGreaterThan(0);

      // Should have all expected block types
      expect(blockTypeCounts.has('resource')).toBe(true);
      expect(blockTypeCounts.has('variable')).toBe(true);
      expect(blockTypeCounts.has('output')).toBe(true);
      expect(blockTypeCounts.has('data')).toBe(true);
      expect(blockTypeCounts.has('module')).toBe(true);
      expect(blockTypeCounts.has('locals')).toBe(true);

      // Verify counts align with byType map from the (deduplicated) index
      const byTypeFromIndex = getBlockTypeCounts(result.index);
      expect(byTypeFromIndex.size).toBeLessThanOrEqual(blockTypeCounts.size);

      // Every type present in the index should exist in stats and not exceed it
      let sumByType = 0;
      for (const [blockType, count] of byTypeFromIndex.entries()) {
        expect(blockTypeCounts.has(blockType)).toBe(true);
        expect(count).toBeGreaterThan(0);
        expect(count).toBeLessThanOrEqual(blockTypeCounts.get(blockType) || 0);
        sumByType += count;
      }
      // Sum across types equals number of blocks in index
      expect(sumByType).toBe(result.index.blocks.length);
    });

    it('should build index and report counts by file', async () => {
      const terraformFiles = testWorkspace
        .getExpectedTerraformFiles()
        .map((relativePath) =>
          path.join(testWorkspace.workspace, relativePath)
        );

      const result = await buildIndex(terraformFiles);

      // Verify file counts (stats reflect files processed; index map is after dedup and module resolution)
      const fileBlockCounts = result.stats.blockFilesCounts;
      expect(fileBlockCounts.size).toBeGreaterThan(0);
      expect(fileBlockCounts.size).toBeLessThanOrEqual(terraformFiles.length);

      // Each tracked file should be from our input set and have > 0 blocks
      for (const [filePath, count] of fileBlockCounts.entries()) {
        expect(terraformFiles.includes(filePath)).toBe(true);
        expect(count).toBeGreaterThan(0);
      }

      // Compare with byFile map from index
      const byFileFromIndex = getFileBlockCounts(result.index);

      let sumByFile = 0;
      for (const [filePath, count] of byFileFromIndex.entries()) {
        // If the file is in stats, index count should not exceed stats count
        if (fileBlockCounts.has(filePath)) {
          expect(count).toBeLessThanOrEqual(fileBlockCounts.get(filePath) || 0);
        }
        sumByFile += count;
      }
      // Sum across files equals number of blocks in index
      expect(sumByFile).toBe(result.index.blocks.length);
    });

    it('should sort blocks by resource name in byType map', async () => {
      const terraformFiles = testWorkspace
        .getExpectedTerraformFiles()
        .map((relativePath) =>
          path.join(testWorkspace.workspace, relativePath)
        );

      const result = await buildIndex(terraformFiles);

      // Check resource sorting
      const resources = result.index.byType.get('resource');
      expect(resources).toBeDefined();
      expect(resources!.length).toBeGreaterThan(1);

      // Verify sorting by name
      for (let i = 1; i < resources!.length; i++) {
        const prev = resources![i - 1];
        const current = resources![i];

        const prevName = prev.name || '';
        const currentName = current.name || '';

        // Names should be in alphabetical order
        expect(prevName.localeCompare(currentName)).toBeLessThanOrEqual(0);
      }

      // Check variable sorting
      const variables = result.index.byType.get('variable');
      expect(variables).toBeDefined();
      expect(variables!.length).toBeGreaterThan(1);

      // Verify sorting by name
      for (let i = 1; i < variables!.length; i++) {
        const prev = variables![i - 1];
        const current = variables![i];

        const prevName = prev.name || '';
        const currentName = current.name || '';

        expect(prevName.localeCompare(currentName)).toBeLessThanOrEqual(0);
      }
    });

    it('should sort blocks by range in byFile map', async () => {
      const terraformFiles = testWorkspace
        .getExpectedTerraformFiles()
        .map((relativePath) =>
          path.join(testWorkspace.workspace, relativePath)
        );

      const result = await buildIndex(terraformFiles);

      // Check each file's block sorting
      for (const [filePath, blocks] of result.index.byFile.entries()) {
        if (blocks.length > 1) {
          // Verify sorting by range start position
          for (let i = 1; i < blocks.length; i++) {
            const prev = blocks[i - 1];
            const current = blocks[i];

            // Start positions should be in ascending order
            expect(prev.range.start).toBeLessThanOrEqual(current.range.start);

            // If start positions are equal, end positions should be in ascending order
            if (prev.range.start === current.range.start) {
              expect(prev.range.end).toBeLessThanOrEqual(current.range.end);
            }
          }
        }
      }
    });

    it('should handle parsing errors gracefully', async () => {
      // Create a fake file path that doesn't exist
      const invalidFiles = [
        path.join(testWorkspace.workspace, 'nonexistent.tf'),
      ];

      const result = await buildIndex(invalidFiles, { continueOnError: true });

      expect(result.stats.filesWithErrors).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].file).toBe(invalidFiles[0]);
    });

    it('should respect maxFiles option', async () => {
      const terraformFiles = testWorkspace
        .getExpectedTerraformFiles()
        .map((relativePath) =>
          path.join(testWorkspace.workspace, relativePath)
        );

      const maxFiles = 3;
      // Ensure deterministic selection for maxFiles: sort input file list
      const sortedTerraformFiles = [...terraformFiles].sort();
      const result = await buildIndex(sortedTerraformFiles, { maxFiles });

      // Exactly maxFiles should be processed in stats (module files are not counted here)
      expect(result.stats.filesProcessed).toBe(maxFiles);

      // Stats should have exactly maxFiles entries for block counts by file
      expect(result.stats.blockFilesCounts.size).toBe(maxFiles);

      // The processed files should be a subset of the first N input files
      const processedFiles = Array.from(result.stats.blockFilesCounts.keys());
      const expectedFiles = new Set(sortedTerraformFiles.slice(0, maxFiles));
      for (const f of processedFiles) {
        expect(expectedFiles.has(f)).toBe(true);
      }

      // Index may include additional module files
      expect(result.index.byFile.size).toBeGreaterThanOrEqual(maxFiles);
    });

    it('should build complete ProjectIndex structure', async () => {
      const terraformFiles = testWorkspace
        .getExpectedTerraformFiles()
        .map((relativePath) =>
          path.join(testWorkspace.workspace, relativePath)
        );

      const result = await buildIndex(terraformFiles);
      const index = result.index;

      // Verify ProjectIndex structure
      expect(index.blocks).toBeInstanceOf(Array);
      expect(index.byType).toBeInstanceOf(Map);
      expect(index.byFile).toBeInstanceOf(Map);
      expect(index.refs).toBeInstanceOf(Array);

      // Verify all blocks are in the main collection
      let totalBlocksInMaps = 0;
      for (const blocks of index.byType.values()) {
        totalBlocksInMaps += blocks.length;
      }
      expect(totalBlocksInMaps).toBe(index.blocks.length);

      // Verify byFile map completeness
      totalBlocksInMaps = 0;
      for (const blocks of index.byFile.values()) {
        totalBlocksInMaps += blocks.length;
      }
      expect(totalBlocksInMaps).toBe(index.blocks.length);
    });
  });

  describe('helper functions', () => {
    let testIndex: any;

    beforeAll(async () => {
      const terraformFiles = testWorkspace
        .getExpectedTerraformFiles()
        .map((relativePath) =>
          path.join(testWorkspace.workspace, relativePath)
        );
      const result = await buildIndex(terraformFiles);
      testIndex = result.index;
    });

    it('should create meaningful index summary', () => {
      const summary = createIndexSummary(testIndex);

      expect(summary).toContain('Total blocks:');
      expect(summary).toContain('Blocks by type:');
      expect(summary).toContain('Blocks by file:');
      expect(summary).toContain('resource:');
      expect(summary).toContain('variable:');
    });

    it('should find blocks by criteria', () => {
      // Find all resources
      const resources = findBlocks(testIndex, { blockType: 'resource' });
      expect(resources.length).toBeGreaterThan(0);
      resources.forEach((block) => expect(block.blockType).toBe('resource'));

      // Find AWS resources
      const awsResources = findBlocks(testIndex, { provider: 'aws' });
      expect(awsResources.length).toBeGreaterThan(0);
      awsResources.forEach((block) => expect(block.provider).toBe('aws'));

      // Find specific resource type
      const vpcResources = findBlocks(testIndex, { kind: 'aws_vpc' });
      expect(vpcResources.length).toBeGreaterThan(0);
      vpcResources.forEach((block) => expect(block.kind).toBe('aws_vpc'));

      // Find by name
      const namedBlocks = findBlocks(testIndex, { name: 'main' });
      expect(namedBlocks.length).toBeGreaterThan(0);
      namedBlocks.forEach((block) => expect(block.name).toBe('main'));
    });

    it('should handle empty search criteria', () => {
      const allBlocks = findBlocks(testIndex, {});
      expect(allBlocks.length).toBe(testIndex.blocks.length);
    });

    it('should handle non-matching search criteria', () => {
      const noBlocks = findBlocks(testIndex, { blockType: 'nonexistent' });
      expect(noBlocks.length).toBe(0);
    });
  });

  describe('comprehensive index validation', () => {
    it('should build index with expected block distribution', async () => {
      const terraformFiles = testWorkspace
        .getExpectedTerraformFiles()
        .map((relativePath) =>
          path.join(testWorkspace.workspace, relativePath)
        );

      const result = await buildIndex(terraformFiles, { verbose: true });

      // Validate expected minimum counts based on test workspace
      const typeCounts = result.stats.blockTypeCounts;

      expect(typeCounts.get('resource') || 0).toBeGreaterThan(5); // main.tf + modules
      expect(typeCounts.get('variable') || 0).toBeGreaterThan(8); // variables.tf + modules + s3.tf.json
      expect(typeCounts.get('output') || 0).toBeGreaterThan(4); // outputs.tf + modules
      expect(typeCounts.get('data') || 0).toBeGreaterThan(3); // data.tf + modules
      expect(typeCounts.get('module') || 0).toBeGreaterThan(1); // main.tf modules
      expect(typeCounts.get('locals') || 0).toBeGreaterThan(0); // locals.tf

      // Validate no errors for valid files
      expect(result.stats.filesWithErrors).toBe(0);
      expect(result.errors.length).toBe(0);
    });

    it('should maintain referential integrity between maps', async () => {
      const terraformFiles = testWorkspace
        .getExpectedTerraformFiles()
        .map((relativePath) =>
          path.join(testWorkspace.workspace, relativePath)
        );

      const result = await buildIndex(terraformFiles);
      const index = result.index;

      // Verify every block in byType maps exists in main blocks array
      const blocksInByType = new Set();
      for (const blocks of index.byType.values()) {
        for (const block of blocks) {
          blocksInByType.add(block);
        }
      }

      // Verify every block in byFile maps exists in main blocks array
      const blocksInByFile = new Set();
      for (const blocks of index.byFile.values()) {
        for (const block of blocks) {
          blocksInByFile.add(block);
        }
      }

      // All blocks should be the same references
      expect(blocksInByType.size).toBe(index.blocks.length);
      expect(blocksInByFile.size).toBe(index.blocks.length);

      for (const block of index.blocks) {
        expect(blocksInByType.has(block)).toBe(true);
        expect(blocksInByFile.has(block)).toBe(true);
      }
    });
  });
});
