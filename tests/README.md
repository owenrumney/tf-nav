# tf-nav Test Suite

This directory contains TypeScript tests for the tf-nav VS Code extension using Jest.

## Structure

```
tests/
├── README.md                    # This file
├── setup.ts                     # Jest setup and VS Code API mocking
├── test-utils.ts                # Test utilities and helpers
├── tsconfig.json                # TypeScript config for tests
├── workspace-validation.test.ts # Validates test workspace structure
├── extension.test.ts            # Main extension integration tests
└── indexer/
    └── files.test.ts            # File discovery functionality tests
```

## Test Workspace

The tests use a comprehensive test workspace located at `test/workspace/` that includes:

### Terraform Files (13 total)
- `main.tf` - Main infrastructure resources
- `variables.tf` - Variable definitions  
- `data.tf` - Data source definitions
- `locals.tf` - Local value definitions
- `outputs.tf` - Output definitions
- `s3.tf.json` - JSON format Terraform file
- `modules/rds/main.tf` - RDS module main file
- `modules/rds/variables.tf` - RDS module variables
- `modules/rds/outputs.tf` - RDS module outputs
- `modules/cloudwatch/main.tf` - CloudWatch module main file
- `modules/cloudwatch/variables.tf` - CloudWatch module variables
- `modules/cloudwatch/outputs.tf` - CloudWatch module outputs
- `modules/cloudwatch/data.tf` - CloudWatch module data sources

### Ignored Files (6 total)
- `.terraform/terraform.tfstate` - Terraform state file
- `.terraform/providers/...` - Provider binaries
- `.terraform/modules/modules.json` - Module metadata
- `scripts/userdata.sh` - Shell script (not Terraform)
- `terraform.tfvars.example` - Example variables file
- `README.md` - Documentation

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- tests/indexer/files.test.ts

# Run specific test by name
npm test -- --testNamePattern="should discover all expected Terraform files"
```

## Test Categories

### 1. File Discovery Tests (`indexer/files.test.ts`)
- Tests the `TerraformFileCollector` class
- Validates file discovery across the test workspace
- Tests ignore pattern functionality
- Verifies both `.tf` and `.tf.json` file discovery
- Tests module directory traversal
- Error handling scenarios

### 2. Extension Integration Tests (`extension.test.ts`)
- Tests VS Code API integration
- Configuration handling
- Error scenarios
- Extension lifecycle

### 3. Workspace Validation Tests (`workspace-validation.test.ts`)
- Ensures test workspace is properly structured
- Validates all expected files are present
- Confirms file classification logic

## Mock Strategy

The tests use comprehensive VS Code API mocking:

- **Workspace API**: Mocked to return test workspace folder
- **Configuration API**: Mocked to return test configuration values
- **File Discovery API**: Simulated file system traversal
- **Output Channel**: Mocked for logging verification

## Adding New Tests

1. **File Discovery Tests**: Add to `indexer/files.test.ts`
2. **Extension Tests**: Add to `extension.test.ts` 
3. **New Test Categories**: Create new files following the naming pattern `*.test.ts`

### Test Utilities

Use the `test-utils.ts` helpers:

```typescript
import { createTestWorkspaceHelper, sortFilePaths } from './test-utils';

const testWorkspace = createTestWorkspaceHelper();
const expectedFiles = testWorkspace.getExpectedTerraformFiles();
```

## Debugging Tests

- Use `console.log()` for debugging (visible in test output)
- Run single tests with `--testNamePattern`
- Use VS Code debugger with Jest extension
- Check test workspace structure with validation tests

## Coverage

Run `npm run test:coverage` to generate coverage reports:
- HTML report: `coverage/lcov-report/index.html`
- Text summary in terminal
- LCOV format for CI integration
