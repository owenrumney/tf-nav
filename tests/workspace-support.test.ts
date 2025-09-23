import * as vscode from 'vscode';
import { TerraformTreeDataProvider } from '../src/ui/tree';
import { TerraformWatcher } from '../src/indexer/watch';
import { TerraformFileCollector } from '../src/indexer/files';

/**
 * Test for multi-root workspace support
 */
describe('Multi-root Workspace Support', () => {
  let treeProvider: TerraformTreeDataProvider;
  let watcher: TerraformWatcher;
  let fileCollector: TerraformFileCollector;

  beforeEach(() => {
    fileCollector = new TerraformFileCollector();
    watcher = new TerraformWatcher(fileCollector, {
      debounceMs: 0, // No debounce for tests
      verbose: false,
      continueOnError: true,
    });
    treeProvider = new TerraformTreeDataProvider(watcher);
  });

  afterEach(() => {
    if (watcher) {
      watcher.dispose();
    }
    if (treeProvider) {
      treeProvider.dispose();
    }
  });

  describe('Workspace Detection', () => {
    test('should detect single workspace', async () => {
      // Mock single workspace
      const mockWorkspace = {
        workspaceFolders: [
          {
            uri: vscode.Uri.file('/workspace1'),
            name: 'workspace1',
            index: 0,
          },
        ],
      };

      // Mock workspace configuration
      Object.defineProperty(vscode.workspace, 'workspaceFolders', {
        get: jest.fn(() => mockWorkspace.workspaceFolders),
        configurable: true,
      });

      const rootChildren = await treeProvider.getChildren();

      // In single workspace mode, should not show workspace nodes
      // Instead should show blocks directly (type or file view)
      expect(rootChildren).toBeDefined();
      expect(rootChildren.length).toBeGreaterThanOrEqual(0);

      // None of the root children should be workspace folders
      const workspaceNodes = rootChildren.filter(
        (child) => child.contextValue === 'workspace-folder'
      );
      expect(workspaceNodes).toHaveLength(0);
    });

    test('should detect multi-root workspace', async () => {
      // Mock multi-root workspace
      const mockWorkspace = {
        workspaceFolders: [
          {
            uri: vscode.Uri.file('/workspace1'),
            name: 'workspace1',
            index: 0,
          },
          {
            uri: vscode.Uri.file('/workspace2'),
            name: 'workspace2',
            index: 1,
          },
        ],
      };

      Object.defineProperty(vscode.workspace, 'workspaceFolders', {
        get: jest.fn(() => mockWorkspace.workspaceFolders),
        configurable: true,
      });

      // Provide a minimal index so the tree renders workspace nodes
      (treeProvider as any).currentIndex = {
        blocks: [
          {
            blockType: 'resource',
            kind: 'aws_instance',
            name: 'a',
            file: '/workspace1/main.tf',
            modulePath: [],
            range: { start: 1, end: 1 },
          },
          {
            blockType: 'variable',
            name: 'b',
            file: '/workspace2/vars.tf',
            modulePath: [],
            range: { start: 1, end: 1 },
          },
        ],
        byType: new Map(),
        byFile: new Map(),
      } as any;

      const rootChildren = await treeProvider.getChildren();

      // In multi-root mode, should show workspace folder nodes
      expect(rootChildren).toBeDefined();

      const workspaceNodes = rootChildren.filter(
        (child) => child.contextValue === 'workspace-folder'
      );
      expect(workspaceNodes).toHaveLength(2);
      expect(workspaceNodes[0].label).toContain('workspace1');
      expect(workspaceNodes[1].label).toContain('workspace2');
    });
  });

  describe('Workspace Filtering', () => {
    test('should filter blocks by workspace', () => {
      // Create mock index with blocks from different workspaces
      const mockIndex = {
        blocks: [
          {
            blockType: 'resource',
            kind: 'aws_instance',
            name: 'web',
            file: '/workspace1/main.tf',
            modulePath: [],
            range: { start: 1, end: 10 },
          },
          {
            blockType: 'resource',
            kind: 'aws_s3_bucket',
            name: 'data',
            file: '/workspace2/storage.tf',
            modulePath: [],
            range: { start: 1, end: 10 },
          },
          {
            blockType: 'variable',
            name: 'region',
            file: '/workspace1/variables.tf',
            modulePath: [],
            range: { start: 1, end: 5 },
          },
        ],
        byType: new Map(),
        byFile: new Map(),
      };

      // Set the mock index
      (treeProvider as any).currentIndex = mockIndex;

      // Test filtering for workspace1
      const workspace1Blocks = (treeProvider as any).getBlocksForWorkspace(
        '/workspace1'
      );
      expect(workspace1Blocks).toHaveLength(2);
      expect(
        workspace1Blocks.every((block: any) =>
          block.file.startsWith('/workspace1')
        )
      ).toBe(true);

      // Test filtering for workspace2
      const workspace2Blocks = (treeProvider as any).getBlocksForWorkspace(
        '/workspace2'
      );
      expect(workspace2Blocks).toHaveLength(1);
      expect(
        workspace2Blocks.every((block: any) =>
          block.file.startsWith('/workspace2')
        )
      ).toBe(true);
    });

    test('should create filtered index for workspace', () => {
      // Create mock index
      const mockIndex = {
        blocks: [
          {
            blockType: 'resource',
            kind: 'aws_instance',
            name: 'web',
            file: '/workspace1/main.tf',
            modulePath: [],
            range: { start: 1, end: 10 },
          },
          {
            blockType: 'data',
            kind: 'aws_ami',
            name: 'ubuntu',
            file: '/workspace1/data.tf',
            modulePath: [],
            range: { start: 1, end: 10 },
          },
          {
            blockType: 'resource',
            kind: 'aws_s3_bucket',
            name: 'data',
            file: '/workspace2/storage.tf',
            modulePath: [],
            range: { start: 1, end: 10 },
          },
        ],
        byType: new Map(),
        byFile: new Map(),
      };

      (treeProvider as any).currentIndex = mockIndex;

      // Test workspace filtering
      const workspace1Index = (
        treeProvider as any
      ).getFilteredIndexForWorkspace('/workspace1');
      expect(workspace1Index.blocks).toHaveLength(2);
      expect(workspace1Index.byType.get('resource')).toHaveLength(1);
      expect(workspace1Index.byType.get('data')).toHaveLength(1);
      expect(workspace1Index.byFile.size).toBe(2);
    });
  });

  describe('Excluded Workspaces', () => {
    test('should show excluded workspaces with proper context value', async () => {
      // Mock multi-root workspace
      const mockWorkspace = {
        workspaceFolders: [
          {
            uri: vscode.Uri.file('/workspace1'),
            name: 'workspace1',
            index: 0,
          },
          {
            uri: vscode.Uri.file('/workspace2'),
            name: 'workspace2',
            index: 1,
          },
        ],
      };

      Object.defineProperty(vscode.workspace, 'workspaceFolders', {
        get: jest.fn(() => mockWorkspace.workspaceFolders),
        configurable: true,
      });

      // Provide a minimal index so the tree renders workspace nodes
      (treeProvider as any).currentIndex = {
        blocks: [
          {
            blockType: 'resource',
            kind: 'aws_instance',
            name: 'a',
            file: '/workspace1/main.tf',
            modulePath: [],
            range: { start: 1, end: 1 },
          },
          {
            blockType: 'variable',
            name: 'b',
            file: '/workspace2/vars.tf',
            modulePath: [],
            range: { start: 1, end: 1 },
          },
        ],
        byType: new Map(),
        byFile: new Map(),
      } as any;

      // Mock configuration with excluded workspace
      const mockConfig = {
        get: jest.fn((key: string, defaultValue?: any) => {
          if (key === 'excludedWorkspaces') {
            return ['workspace2'];
          }
          return defaultValue;
        }),
        update: jest.fn(),
      };

      jest
        .spyOn(vscode.workspace, 'getConfiguration')
        .mockReturnValue(mockConfig as any);

      const rootChildren = await treeProvider.getChildren();

      expect(rootChildren).toHaveLength(2);

      // workspace1 should be normal
      const workspace1 = rootChildren.find((child) =>
        child.label.includes('workspace1')
      );
      expect(workspace1?.contextValue).toBe('workspace-folder');
      expect(workspace1?.collapsibleState).toBe(
        vscode.TreeItemCollapsibleState.Collapsed
      );

      // workspace2 should be excluded
      const workspace2 = rootChildren.find((child) =>
        child.label.includes('workspace2')
      );
      expect(workspace2?.contextValue).toBe('workspace-folder-excluded');
      expect(workspace2?.collapsibleState).toBe(
        vscode.TreeItemCollapsibleState.None
      );
      expect(workspace2?.label).toContain('(excluded)');
    });

    test('should not allow expanding excluded workspaces', async () => {
      const excludedWorkspaceItem = {
        contextValue: 'workspace-folder-excluded',
        terraformAddress: '/workspace2',
      };

      const children = await treeProvider.getChildren(
        excludedWorkspaceItem as any
      );
      expect(children).toHaveLength(0);
    });
  });

  describe('Path Calculations', () => {
    test('should calculate relative paths correctly for workspace files', () => {
      // This tests the relative path calculation in getBlocksByFileForWorkspace
      const mockIndex = {
        blocks: [
          {
            blockType: 'resource',
            kind: 'aws_instance',
            name: 'web',
            file: '/workspace1/modules/vpc/main.tf',
            modulePath: [],
            range: { start: 1, end: 10 },
          },
        ],
        byType: new Map(),
        byFile: new Map([
          [
            '/workspace1/modules/vpc/main.tf',
            [
              {
                blockType: 'resource',
                kind: 'aws_instance',
                name: 'web',
                file: '/workspace1/modules/vpc/main.tf',
                modulePath: [],
                range: { start: 1, end: 10 },
              },
            ],
          ],
        ]),
      };

      (treeProvider as any).currentIndex = mockIndex;

      // Call getBlocksByFileForWorkspace method
      const fileItems = (treeProvider as any).getBlocksByFileForWorkspace(
        mockIndex,
        '/workspace1'
      );

      expect(fileItems).resolves.toHaveLength(1);

      // The label should show relative path from workspace root
      fileItems.then((items: any[]) => {
        expect(items[0].label).toContain('modules/vpc/main.tf');
        expect(items[0].label).not.toContain('/workspace1');
      });
    });
  });
});

/**
 * Manual testing scenarios to verify functionality:
 *
 * 1. Single workspace:
 *    - Open a folder with Terraform files
 *    - Verify tree shows blocks directly (no workspace nodes)
 *
 * 2. Multi-root workspace:
 *    - Create a workspace file with multiple folders
 *    - Open the workspace
 *    - Verify tree shows workspace folder nodes
 *    - Expand each workspace to see its Terraform content
 *
 * 3. Exclude/Include workflow:
 *    - In multi-root workspace, right-click on a workspace folder
 *    - Select "Exclude Workspace"
 *    - Verify workspace shows as "(excluded)" and is not expandable
 *    - Right-click on excluded workspace and select "Include Workspace"
 *    - Verify workspace becomes normal again
 *
 * 4. Configuration persistence:
 *    - Exclude a workspace and close VS Code
 *    - Reopen workspace and verify exclusion persists
 *
 * 5. Path filtering:
 *    - Verify that each workspace only shows its own Terraform files
 *    - Check that file paths are relative to workspace root
 */
