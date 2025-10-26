# Test Suite for Obsidian KISSS3 Plugin

This test suite provides comprehensive coverage for all sync scenarios in the KISSS3 plugin, implementing tests with mocked S3 backend as requested.

## Overview

The test suite covers all aspects of the three-source synchronization algorithm described in `SYNC.md`, including:

- **File creation** scenarios (local/remote)
- **File modification** scenarios (local/remote)  
- **File deletion** scenarios (local/remote)
- **Conflict resolution** cases
- **Edge cases** and complex sync scenarios
- **Error handling** and recovery
- **State management** and persistence

## Test Structure

```
tests/
├── mocks/                     # Mock implementations
│   ├── MockObsidianApp.ts    # Mock Obsidian App, Vault, TFile interfaces
│   ├── MockS3Service.ts      # Mock S3 service for testing
│   ├── MockPlugin.ts         # Mock plugin implementation
│   └── obsidian.ts           # Mock Obsidian module
├── s3/
│   └── S3Service.test.ts     # S3Service unit tests
├── sync/
│   ├── SyncDecisionEngine.test.ts    # Decision engine logic tests
│   ├── SyncManager.test.ts           # SyncManager unit tests
│   ├── SyncStateManager.test.ts      # State persistence tests
│   └── SyncIntegration.test.ts       # Integration tests for complete scenarios
├── setup.ts                  # Test setup and configuration
└── README.md                 # This file
```

## Test Categories

### 1. SyncDecisionEngine Tests (`SyncDecisionEngine.test.ts`)
Tests the core decision-making logic for sync operations:

- **Single-source changes**: Tests basic upload/download/delete decisions
- **Conflict resolution**: Tests all conflict scenarios from the sync matrix
- **Edge cases**: Tests complex scenarios with multiple files
- **Debug logging**: Tests logging behavior

**Coverage**: All sync decision matrix cases from SYNC.md

### 2. S3Service Tests (`S3Service.test.ts`)
Tests S3 backend operations with mocked AWS SDK:

- **Configuration**: Tests service setup and validation
- **File operations**: Upload, download, delete, metadata retrieval  
- **Remote key conversion**: Tests path prefix handling
- **Error handling**: Tests error scenarios and recovery
- **Exclusion rules**: Tests hidden file filtering

**Coverage**: Complete S3 interface with 94% code coverage

### 3. SyncStateManager Tests (`SyncStateManager.test.ts`)
Tests state persistence and management:

- **State loading/saving**: Tests plugin data API integration
- **Error handling**: Tests graceful failure recovery
- **Complex scenarios**: Tests large state files, concurrent access
- **Legacy compatibility**: Tests backward compatibility

**Coverage**: 100% code coverage for state management

### 4. Integration Tests (`SyncIntegration.test.ts`)
Tests complete sync scenarios end-to-end:

- **Initial sync**: First-time sync with local files only
- **Bidirectional changes**: Tests complex multi-file scenarios
- **Deletion scenarios**: Tests all deletion conflict cases
- **Large scale**: Tests performance with 100+ files
- **Edge cases**: Tests special file names and nested structures

### 5. SyncManager Tests (`SyncManager.test.ts`)
Tests the main sync orchestration:

- **Basic functionality**: Tests instantiation and configuration
- **File exclusion**: Tests hidden file filtering logic
- **Error handling**: Tests graceful failure scenarios

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

## Mock Architecture

### MockS3Service
- Simulates S3 operations in memory
- Supports all S3Service methods
- Provides test helper methods for setup
- Handles remote prefix logic correctly

### MockObsidianApp
- Implements Obsidian Vault interface
- Simulates file operations in memory
- Supports nested folder structures
- Provides realistic file stats and metadata

### MockPlugin
- Implements plugin data persistence
- Supports settings management
- Provides debug logging configuration

## Coverage Report

Current test coverage:
- **S3Service**: 94.73% statement coverage
- **SyncDecisionEngine**: 91.89% statement coverage  
- **SyncStateManager**: 100% statement coverage
- **SyncTypes**: 100% statement coverage
- **Overall**: 52.39% project coverage

Lower SyncManager coverage is expected as it orchestrates other components that are fully tested in isolation.

## Test Scenarios Covered

All sync decision matrix cases from SYNC.md:

| Local Status      | Remote Status     | Expected Action      | Test Coverage |
|-------------------|-------------------|---------------------|---------------|
| Created           | Unchanged         | Upload              | ✓ |
| Modified          | Unchanged         | Upload              | ✓ |
| Deleted           | Unchanged         | Delete remote       | ✓ |
| Unchanged         | Created           | Download            | ✓ |
| Unchanged         | Modified          | Download            | ✓ |
| Unchanged         | Deleted           | Delete local        | ✓ |
| Deleted           | Deleted           | Do Nothing          | ✓ |
| Deleted           | Modified/Created  | Download            | ✓ |
| Modified/Created  | Deleted           | Upload              | ✓ |
| Created/Modified  | Created/Modified  | Conflict Resolution | ✓ |
| Unchanged         | Unchanged         | Do Nothing          | ✓ |

Additional scenarios:
- ✓ Hidden file exclusion (files starting with '.')
- ✓ Nested folder creation and management
- ✓ Special characters in file names
- ✓ Large-scale sync (100+ files)
- ✓ Concurrent operation handling
- ✓ Error recovery and graceful degradation
- ✓ State persistence across sync operations
- ✓ Legacy state format compatibility

## Adding New Tests

When adding new tests:

1. **Use existing mocks** instead of creating new ones
2. **Test both success and failure paths**
3. **Include edge cases** and boundary conditions
4. **Follow naming conventions** (describe what, not how)
5. **Group related tests** in describe blocks
6. **Use realistic test data** that matches actual usage

Example test structure:
```typescript
describe('Feature Name', () => {
  describe('Normal operation', () => {
    test('should handle typical case', () => {
      // Test implementation
    });
  });
  
  describe('Error cases', () => {
    test('should handle error gracefully', () => {
      // Test implementation  
    });
  });
});
```

## Contributing

When modifying sync logic:
1. **Update tests first** to reflect expected behavior
2. **Ensure all tests pass** before submitting changes
3. **Maintain test coverage** above 90% for new code
4. **Add integration tests** for complex features
5. **Test error scenarios** thoroughly