// Jest test setup
import * as path from 'path';

// Mock VS Code API since we can't run it in Jest
const mockVSCode = {
  workspace: {
    workspaceFolders: [
      {
        uri: { fsPath: path.join(__dirname,  'workspace') },
        name: 'test-workspace',
        index: 0,
      },
    ],
    getConfiguration: jest.fn().mockReturnValue({
      get: jest.fn((key: string, defaultValue?: any) => {
        const config: Record<string, any> = {
          'tfnav.ignore': ['**/.terraform/**'],
          'tfnav.viewMode': 'type',
          'tfnav.includeDataSources': true,
        };
        return config[key] ?? defaultValue;
      }),
    }),
    findFiles: jest.fn(),
    createFileSystemWatcher: jest.fn(() => ({
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
      onDidCreate: jest.fn(() => ({ dispose: jest.fn() })),
      onDidDelete: jest.fn(() => ({ dispose: jest.fn() })),
      dispose: jest.fn()
    })),
    fs: {
      readFile: jest.fn()
    },
  },
  window: {
    createOutputChannel: jest.fn().mockReturnValue({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
    }),
    createStatusBarItem: jest.fn().mockReturnValue({
      text: '',
      tooltip: '',
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn(),
    }),
    showInformationMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    showErrorMessage: jest.fn(),
  },
  Uri: {
    file: jest.fn((path: string) => ({ fsPath: path })),
  },
  RelativePattern: jest.fn((base: any, pattern: string) => ({ 
    base: base, 
    pattern: pattern 
  })),
  EventEmitter: jest.fn(() => ({
    event: jest.fn(),
    fire: jest.fn(),
    dispose: jest.fn(),
  })),
  TreeItem: jest.fn().mockImplementation((label, collapsibleState) => ({
    label,
    collapsibleState,
    tooltip: '',
    contextValue: '',
    iconPath: null,
    command: null
  })),
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2,
  },
  StatusBarAlignment: {
    Left: 1,
    Right: 2,
  },
  ThemeIcon: jest.fn().mockImplementation((id) => ({ id })),
};

// Mock the vscode module
jest.mock('vscode', () => mockVSCode, { virtual: true });

// Global test constants
declare global {
  var TEST_WORKSPACE_PATH: string;
  var mockVSCode: any;
}

global.TEST_WORKSPACE_PATH = path.join(__dirname,  'workspace');
global.mockVSCode = mockVSCode;
