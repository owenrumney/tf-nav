// Tests for Terraform file discovery functionality
import * as path from 'path';
import * as fs from 'fs';
import { TerraformFileCollector } from '../../src/indexer/files';
import { createTestWorkspaceHelper, sortFilePaths } from '../test-utils';

describe('TerraformFileCollector', () => {
  let collector: TerraformFileCollector;
  let testWorkspace: ReturnType<typeof createTestWorkspaceHelper>;

  beforeAll(() => {
    testWorkspace = createTestWorkspaceHelper();

    // Validate test workspace exists and is properly structured
    const validation = testWorkspace.validateWorkspace();
    if (!validation.isValid) {
      throw new Error(
        `Test workspace validation failed:\n${validation.errors.join('\n')}`
      );
    }
  });

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create a fresh collector for each test
    collector = new TerraformFileCollector();
  });

  afterEach(() => {
    // Clean up collector
    if (collector) {
      collector.dispose();
    }
  });

  describe('findTfFiles', () => {
    beforeEach(() => {
      // Mock VS Code's findFiles to simulate the actual calls made by TerraformFileCollector
      const allFiles = testWorkspace.getAllFiles();

      (global as any).mockVSCode.workspace.findFiles.mockImplementation(
        (pattern: any, exclude: any) => {
          // The TerraformFileCollector makes separate calls for .tf and .tf.json files
          const patternStr = pattern.pattern || '';

          const matchingFiles = allFiles
            .filter((file) => !file.isDirectory)
            .filter((file) => {
              if (patternStr.includes('*.tf.json')) {
                return file.path.endsWith('.tf.json');
              }
              if (patternStr.includes('*.tf')) {
                return (
                  file.path.endsWith('.tf') && !file.path.endsWith('.tf.json')
                );
              }
              return false;
            })
            .filter((file) => {
              // Apply exclude patterns (ignore .terraform directory)
              return !file.relativePath.includes('.terraform');
            })
            .map((file) => ({ fsPath: file.path }));

          return Promise.resolve(matchingFiles);
        }
      );
    });

    it('should discover all expected Terraform files', async () => {
      const discoveredFiles = await collector.findTfFiles();
      const expectedFiles = testWorkspace.getExpectedTerraformFiles();

      // Convert to relative paths for comparison
      const workspacePath = path.join(__dirname, '..', 'workspace');
      const discoveredRelativePaths = discoveredFiles.map((file) =>
        path.relative(workspacePath, file)
      );

      // Sort both arrays for consistent comparison
      const sortedDiscovered = sortFilePaths(discoveredRelativePaths);
      const sortedExpected = sortFilePaths(expectedFiles);

      expect(sortedDiscovered).toEqual(sortedExpected);
    });

    it('should ignore files in .terraform directory', async () => {
      const discoveredFiles = await collector.findTfFiles();

      // No discovered file should contain .terraform in its path
      const terraformFiles = discoveredFiles.filter((file) =>
        file.includes('.terraform')
      );

      expect(terraformFiles).toHaveLength(0);
    });

    it('should discover both .tf and .tf.json files', async () => {
      const discoveredFiles = await collector.findTfFiles();

      const tfFiles = discoveredFiles.filter(
        (file) => file.endsWith('.tf') && !file.endsWith('.tf.json')
      );
      const tfJsonFiles = discoveredFiles.filter((file) =>
        file.endsWith('.tf.json')
      );

      expect(tfFiles.length).toBeGreaterThan(0);
      expect(tfJsonFiles.length).toBeGreaterThan(0);

      // Should have at least one .tf.json file (s3.tf.json)
      const s3JsonFile = tfJsonFiles.find((file) =>
        file.includes('s3.tf.json')
      );
      expect(s3JsonFile).toBeDefined();
    });

    it('should discover files in nested module directories', async () => {
      const discoveredFiles = await collector.findTfFiles();

      const moduleFiles = discoveredFiles.filter((file) =>
        file.includes('/modules/')
      );

      expect(moduleFiles.length).toBeGreaterThan(0);

      // Should find RDS module files
      const rdsFiles = moduleFiles.filter((file) => file.includes('/rds/'));
      expect(rdsFiles.length).toBeGreaterThanOrEqual(3); // main.tf, variables.tf, outputs.tf

      // Should find CloudWatch module files
      const cloudwatchFiles = moduleFiles.filter((file) =>
        file.includes('/cloudwatch/')
      );
      expect(cloudwatchFiles.length).toBeGreaterThanOrEqual(4); // main.tf, variables.tf, outputs.tf, data.tf
    });

    it('should return absolute file paths', async () => {
      const discoveredFiles = await collector.findTfFiles();

      expect(discoveredFiles.length).toBeGreaterThan(0);

      // All paths should be absolute
      discoveredFiles.forEach((filePath) => {
        expect(path.isAbsolute(filePath)).toBe(true);
      });
    });

    it('should return sorted file paths', async () => {
      const discoveredFiles = await collector.findTfFiles();
      const sortedFiles = [...discoveredFiles].sort();

      expect(discoveredFiles).toEqual(sortedFiles);
    });

    it('should handle empty workspace gracefully', async () => {
      // Mock empty workspace
      (global as any).mockVSCode.workspace.workspaceFolders = [];

      const discoveredFiles = await collector.findTfFiles();

      expect(discoveredFiles).toEqual([]);
    });

    it('should respect custom ignore patterns', async () => {
      // Mock configuration with custom ignore patterns
      (global as any).mockVSCode.workspace.getConfiguration.mockReturnValue({
        get: jest.fn((key: string, defaultValue?: any) => {
          if (key === 'ignore') {
            return ['**/.terraform/**', '**/modules/**']; // Also ignore modules
          }
          return defaultValue;
        }),
      });

      const discoveredFiles = await collector.findTfFiles();

      // Should not find any files in modules directory
      const moduleFiles = discoveredFiles.filter((file) =>
        file.includes('/modules/')
      );

      expect(moduleFiles).toHaveLength(0);
    });
  });

  describe('disposal', () => {
    it('should dispose output channel when disposed', () => {
      const mockOutputChannel = (
        global as any
      ).mockVSCode.window.createOutputChannel();

      collector.dispose();

      expect(mockOutputChannel.dispose).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle file system errors gracefully', async () => {
      // Mock findFiles to throw an error
      (global as any).mockVSCode.workspace.findFiles.mockRejectedValue(
        new Error('File system error')
      );

      const discoveredFiles = await collector.findTfFiles();

      // Should return empty array on error, not throw
      expect(discoveredFiles).toEqual([]);
    });
  });
});

describe('File Discovery Integration', () => {
  it('should match expected test workspace structure', () => {
    const testWorkspace = createTestWorkspaceHelper();
    const validation = testWorkspace.validateWorkspace();

    expect(validation.isValid).toBe(true);

    if (!validation.isValid) {
      console.error('Validation errors:', validation.errors);
    }
  });

  it('should have all expected test files present', () => {
    const testWorkspace = createTestWorkspaceHelper();
    const expectedFiles = testWorkspace.getExpectedTerraformFiles();
    const workspacePath = path.join(__dirname, '..', 'workspace');

    expectedFiles.forEach((expectedFile) => {
      const fullPath = path.join(workspacePath, expectedFile);
      expect(fs.existsSync(fullPath)).toBe(true);
    });
  });

  it('should have ignore test files present', () => {
    const testWorkspace = createTestWorkspaceHelper();
    const ignoredFiles = testWorkspace.getIgnoredFiles();
    const workspacePath = path.join(__dirname, '..', 'workspace');

    // At least some ignored files should exist to test ignore functionality
    const existingIgnoredFiles = ignoredFiles.filter((ignoredFile) => {
      const fullPath = path.join(workspacePath, ignoredFile);
      return fs.existsSync(fullPath);
    });

    expect(existingIgnoredFiles.length).toBeGreaterThan(0);
  });
});
