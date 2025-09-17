// Simple test to validate our test workspace structure
import { createTestWorkspaceHelper } from './test-utils';
import * as path from 'path';
import * as fs from 'fs';

describe('Test Workspace Validation', () => {
  let testWorkspace: ReturnType<typeof createTestWorkspaceHelper>;

  beforeAll(() => {
    testWorkspace = createTestWorkspaceHelper();
  });

  it('should have a valid test workspace', () => {
    const validation = testWorkspace.validateWorkspace();

    if (!validation.isValid) {
      console.error('Validation errors:', validation.errors);
    }

    expect(validation.isValid).toBe(true);
  });

  it('should have expected Terraform files', () => {
    const expectedFiles = testWorkspace.getExpectedTerraformFiles();
    const workspacePath = path.join(__dirname, 'workspace');

    console.log('Expected files:', expectedFiles);
    console.log('Workspace path:', workspacePath);

    const missingFiles: string[] = [];
    const existingFiles: string[] = [];

    expectedFiles.forEach((expectedFile) => {
      const fullPath = path.join(workspacePath, expectedFile);
      if (fs.existsSync(fullPath)) {
        existingFiles.push(expectedFile);
      } else {
        missingFiles.push(expectedFile);
      }
    });

    console.log('Existing files:', existingFiles);
    console.log('Missing files:', missingFiles);

    expect(missingFiles).toHaveLength(0);
    expect(existingFiles.length).toBeGreaterThan(0);
  });

  it('should have ignore test files', () => {
    const ignoredFiles = testWorkspace.getIgnoredFiles();
    const workspacePath = path.join(__dirname, 'workspace');

    const existingIgnoredFiles = ignoredFiles.filter((ignoredFile) => {
      const fullPath = path.join(workspacePath, ignoredFile);
      return fs.existsSync(fullPath);
    });

    console.log('Ignored files that exist:', existingIgnoredFiles);

    expect(existingIgnoredFiles.length).toBeGreaterThan(0);
  });

  it('should classify files correctly', () => {
    const allFiles = testWorkspace.getAllFiles();

    const terraformFiles = allFiles.filter((file) => file.shouldBeDiscovered);
    const ignoredFiles = allFiles.filter(
      (file) => !file.shouldBeDiscovered && !file.isDirectory
    );

    console.log('Terraform files found:', terraformFiles.length);
    console.log('Ignored files found:', ignoredFiles.length);

    expect(terraformFiles.length).toBeGreaterThan(0);
    expect(ignoredFiles.length).toBeGreaterThan(0);
  });
});
