// Tests for main extension functionality
import * as vscode from 'vscode';
import { TerraformFileCollector } from '../src/indexer/files';

// Mock the extension module
jest.mock('../src/extension', () => ({
  activate: jest.fn(),
  deactivate: jest.fn(),
}));

describe('Extension Integration', () => {
  let mockContext: vscode.ExtensionContext;

  beforeEach(() => {
    jest.clearAllMocks();

    mockContext = {
      subscriptions: [],
      workspaceState: {
        get: jest.fn(),
        update: jest.fn(),
      },
      globalState: {
        get: jest.fn(),
        update: jest.fn(),
      },
      extensionPath: '/mock/extension/path',
      storagePath: '/mock/storage/path',
      globalStoragePath: '/mock/global/storage/path',
    } as any;
  });

  describe('TerraformFileCollector Integration', () => {
    let collector: TerraformFileCollector;

    beforeEach(() => {
      collector = new TerraformFileCollector();
    });

    afterEach(() => {
      if (collector) {
        collector.dispose();
      }
    });

    it('should create output channel on instantiation', () => {
      const mockCreateOutputChannel = (global as any).mockVSCode.window
        .createOutputChannel;

      expect(mockCreateOutputChannel).toHaveBeenCalledWith(
        'Terraform Navigator'
      );
    });

    it('should use workspace configuration for ignore patterns', async () => {
      const mockGetConfiguration = (global as any).mockVSCode.workspace
        .getConfiguration;

      await collector.findTfFiles();

      expect(mockGetConfiguration).toHaveBeenCalledWith('tfnav');
    });

    it('should handle configuration changes', async () => {
      // Test that the collector respects configuration
      const mockConfig = {
        get: jest.fn().mockImplementation((key: string, defaultValue?: any) => {
          if (key === 'ignore') {
            return ['**/.terraform/**', '**/custom-ignore/**'];
          }
          return defaultValue;
        }),
      };

      (global as any).mockVSCode.workspace.getConfiguration.mockReturnValue(
        mockConfig
      );

      // Create new collector to test with updated config
      const newCollector = new TerraformFileCollector();

      // The collector calls findTfFiles which calls get() with 'ignore'
      await newCollector.findTfFiles();

      expect(mockConfig.get).toHaveBeenCalledWith('ignore', [
        '**/.terraform/**',
      ]);

      newCollector.dispose();
    });
  });

  describe('VS Code API Integration', () => {
    it('should properly mock VS Code workspace API', () => {
      const mockWorkspace = (global as any).mockVSCode.workspace;

      expect(mockWorkspace.workspaceFolders).toBeDefined();
      expect(mockWorkspace.getConfiguration).toBeDefined();
      expect(mockWorkspace.findFiles).toBeDefined();
    });

    it('should properly mock VS Code window API', () => {
      const mockWindow = (global as any).mockVSCode.window;

      expect(mockWindow.createOutputChannel).toBeDefined();
    });

    it('should properly mock VS Code Uri API', () => {
      const mockUri = (global as any).mockVSCode.Uri;

      expect(mockUri.file).toBeDefined();

      const testUri = mockUri.file('/tests/path');
      expect(testUri.fsPath).toBe('/tests/path');
    });
  });

  describe('Configuration Handling', () => {
    it('should handle default configuration values', async () => {
      const mockConfig = {
        get: jest
          .fn()
          .mockImplementation(
            (key: string, defaultValue?: any) => defaultValue
          ),
      };

      (global as any).mockVSCode.workspace.getConfiguration.mockReturnValue(
        mockConfig
      );

      const collector = new TerraformFileCollector();

      // The collector calls findTfFiles which calls get() with 'ignore'
      await collector.findTfFiles();

      // Should use default ignore patterns when none configured
      expect(mockConfig.get).toHaveBeenCalledWith('ignore', [
        '**/.terraform/**',
      ]);

      collector.dispose();
    });

    it('should handle missing configuration gracefully', () => {
      const mockConfig = {
        get: jest.fn().mockReturnValue(undefined),
      };

      (global as any).mockVSCode.workspace.getConfiguration.mockReturnValue(
        mockConfig
      );

      expect(() => {
        const collector = new TerraformFileCollector();
        collector.dispose();
      }).not.toThrow();
    });
  });

  describe('Error Scenarios', () => {
    it('should handle workspace.findFiles errors', async () => {
      (global as any).mockVSCode.workspace.findFiles.mockRejectedValue(
        new Error('Mock file system error')
      );

      const collector = new TerraformFileCollector();

      // Should not throw, should return empty array
      await expect(collector.findTfFiles()).resolves.toEqual([]);

      collector.dispose();
    });

    it('should handle missing workspace folders', async () => {
      (global as any).mockVSCode.workspace.workspaceFolders = null;

      const collector = new TerraformFileCollector();

      const result = await collector.findTfFiles();
      expect(result).toEqual([]);

      collector.dispose();
    });

    it('should handle empty workspace folders array', async () => {
      (global as any).mockVSCode.workspace.workspaceFolders = [];

      const collector = new TerraformFileCollector();

      const result = await collector.findTfFiles();
      expect(result).toEqual([]);

      collector.dispose();
    });
  });
});
