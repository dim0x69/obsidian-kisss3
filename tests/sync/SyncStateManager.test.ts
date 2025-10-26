import { SyncStateManager } from '../../sync/SyncStateManager';
import { SyncState, SyncFileState } from '../../sync/SyncTypes';
import { MockApp } from '../mocks/MockObsidianApp';
import { MockPlugin } from '../mocks/MockPlugin';

describe('SyncStateManager', () => {
  let stateManager: SyncStateManager;
  let mockApp: MockApp;
  let mockPlugin: MockPlugin;

  beforeEach(() => {
    mockApp = new MockApp();
    mockPlugin = new MockPlugin();
    stateManager = new SyncStateManager(mockApp as any, mockPlugin as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Loading state', () => {
    test('Loads existing state successfully', async () => {
      const mockSyncState: SyncState = {
        'file1.md': { localMtime: 1000, remoteMtime: 1500 },
        'file2.md': { localMtime: 2000, remoteMtime: undefined },
        'file3.md': { localMtime: undefined, remoteMtime: 2500 },
      };

      mockPlugin.setPluginData({
        syncState: mockSyncState,
        otherData: 'preserved',
      });

      const result = await stateManager.loadState();

      expect(result).toEqual(mockSyncState);
    });

    test('Returns empty state when no state exists', async () => {
      mockPlugin.clearData();

      const result = await stateManager.loadState();

      expect(result).toEqual({});
    });

    test('Returns empty state when plugin data is null', async () => {
      mockPlugin.loadData = jest.fn().mockResolvedValue(null);

      const result = await stateManager.loadState();

      expect(result).toEqual({});
    });

    test('Handles load errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      mockPlugin.loadData = jest.fn().mockRejectedValue(new Error('Load failed'));

      const result = await stateManager.loadState();

      expect(result).toEqual({});
      expect(consoleSpy).toHaveBeenCalledWith(
        'S3 Sync: Could not load sync state, starting with empty state:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    test('Handles missing syncState key', async () => {
      mockPlugin.setPluginData({
        otherData: 'exists',
      });

      const result = await stateManager.loadState();

      expect(result).toEqual({});
    });
  });

  describe('Saving state', () => {
    test('Saves state successfully', async () => {
      const newSyncState: SyncState = {
        'file1.md': { localMtime: 3000, remoteMtime: 3500 },
        'file2.md': { localMtime: 4000, remoteMtime: undefined },
      };

      mockPlugin.setPluginData({
        existingData: 'preserved',
      });

      await stateManager.saveState(newSyncState);

      const savedData = mockPlugin.getPluginData();
      expect(savedData.syncState).toEqual(newSyncState);
      expect(savedData.existingData).toBe('preserved'); // Other data is preserved
    });

    test('Saves to empty plugin data', async () => {
      const newSyncState: SyncState = {
        'file1.md': { localMtime: 1000, remoteMtime: 1500 },
      };

      mockPlugin.clearData();

      await stateManager.saveState(newSyncState);

      const savedData = mockPlugin.getPluginData();
      expect(savedData.syncState).toEqual(newSyncState);
    });

    test('Handles save errors', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const saveError = new Error('Save failed');
      mockPlugin.saveData = jest.fn().mockRejectedValue(saveError);

      const newSyncState: SyncState = {
        'file1.md': { localMtime: 1000, remoteMtime: 1500 },
      };

      await expect(stateManager.saveState(newSyncState)).rejects.toThrow('Failed to save sync state: Save failed');
      
      expect(consoleSpy).toHaveBeenCalledWith('S3 Sync: Failed to save sync state:', saveError);

      consoleSpy.mockRestore();
    });

    test('Preserves other plugin data when saving', async () => {
      const existingData = {
        settings: { key: 'value' },
        otherState: { data: 'important' },
      };

      mockPlugin.setPluginData(existingData);

      const newSyncState: SyncState = {
        'new-file.md': { localMtime: 5000, remoteMtime: 5500 },
      };

      await stateManager.saveState(newSyncState);

      const savedData = mockPlugin.getPluginData();
      expect(savedData.syncState).toEqual(newSyncState);
      expect(savedData.settings).toEqual(existingData.settings);
      expect(savedData.otherState).toEqual(existingData.otherState);
    });

    test('Handles null plugin data during save', async () => {
      mockPlugin.loadData = jest.fn().mockResolvedValue(null);

      const newSyncState: SyncState = {
        'file1.md': { localMtime: 1000, remoteMtime: 1500 },
      };

      await stateManager.saveState(newSyncState);

      const savedData = mockPlugin.getPluginData();
      expect(savedData.syncState).toEqual(newSyncState);
    });

    test('Debug logging when enabled', async () => {
      const consoleSpy = jest.spyOn(console, 'info').mockImplementation();
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      mockPlugin.settings.enableDebugLogging = true;

      const newSyncState: SyncState = {
        'file1.md': { localMtime: 1000, remoteMtime: 1500 },
      };

      await stateManager.saveState(newSyncState);

      expect(consoleSpy).toHaveBeenCalledWith('Saving sync state...');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'S3 Sync: Successfully saved sync state to plugin data API'
      );

      consoleSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    test('No debug logging when disabled', async () => {
      const consoleSpy = jest.spyOn(console, 'info').mockImplementation();
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      mockPlugin.settings.enableDebugLogging = false;

      const newSyncState: SyncState = {
        'file1.md': { localMtime: 1000, remoteMtime: 1500 },
      };

      await stateManager.saveState(newSyncState);

      expect(consoleSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });
  });

  describe('Clear state', () => {
    test('Clears state successfully', async () => {
      const initialState: SyncState = {
        'file1.md': { localMtime: 1000, remoteMtime: 1500 },
        'file2.md': { localMtime: 2000, remoteMtime: 2500 },
      };

      mockPlugin.setPluginData({
        syncState: initialState,
        otherData: 'preserved',
      });

      await stateManager.clearState();

      const savedData = mockPlugin.getPluginData();
      expect(savedData.syncState).toEqual({});
      expect(savedData.otherData).toBe('preserved'); // Other data is preserved
    });
  });

  describe('Complex state scenarios', () => {
    test('Handles mixed valid and invalid state entries', async () => {
      const mixedState = {
        syncState: {
          'valid-file.md': { localMtime: 1000, remoteMtime: 1500 },
          'partial-file.md': { localMtime: 2000 }, // Missing remoteMtime
          'invalid-file.md': null, // Invalid entry
          'another-valid.md': { localMtime: undefined, remoteMtime: 3000 },
        },
      };

      mockPlugin.setPluginData(mixedState);

      const result = await stateManager.loadState();

      // Should load all entries as-is, validation happens elsewhere
      expect(result).toEqual(mixedState.syncState);
    });

    test('Handles legacy state format', async () => {
      const legacyState = {
        syncState: {
          'legacy-file.md': '1000', // Old string format
          'new-file.md': { localMtime: 2000, remoteMtime: 2500 }, // New object format
        },
      };

      mockPlugin.setPluginData(legacyState);

      const result = await stateManager.loadState();

      expect(result).toEqual(legacyState.syncState);
    });

    test('Saves empty state', async () => {
      const emptyState: SyncState = {};

      await stateManager.saveState(emptyState);

      const savedData = mockPlugin.getPluginData();
      expect(savedData.syncState).toEqual({});
    });

    test('Saves large state', async () => {
      const largeState: SyncState = {};
      
      // Create a large state with many files
      for (let i = 0; i < 1000; i++) {
        largeState[`file${i}.md`] = {
          localMtime: 1000 + i,
          remoteMtime: 2000 + i,
        };
      }

      await stateManager.saveState(largeState);

      const savedData = mockPlugin.getPluginData();
      expect(savedData.syncState).toEqual(largeState);
      expect(Object.keys(savedData.syncState)).toHaveLength(1000);
    });

    test('State with various timestamp formats', async () => {
      const stateWithTimestamps: SyncState = {
        'current.md': { localMtime: Date.now(), remoteMtime: Date.now() + 1000 },
        'old.md': { localMtime: 946684800000, remoteMtime: 946684801000 }, // Year 2000
        'future.md': { localMtime: 4102444800000, remoteMtime: 4102444801000 }, // Year 2100
        'undefined-local.md': { localMtime: undefined, remoteMtime: 1000 },
        'undefined-remote.md': { localMtime: 1000, remoteMtime: undefined },
        'both-undefined.md': { localMtime: undefined, remoteMtime: undefined },
      };

      await stateManager.saveState(stateWithTimestamps);
      const result = await stateManager.loadState();

      expect(result).toEqual(stateWithTimestamps);
    });
  });

  describe('Concurrent access', () => {
    test('Handles concurrent load operations', async () => {
      const testState: SyncState = {
        'concurrent.md': { localMtime: 1000, remoteMtime: 1500 },
      };

      mockPlugin.setPluginData({ syncState: testState });

      // Start multiple load operations simultaneously
      const loads = Promise.all([
        stateManager.loadState(),
        stateManager.loadState(),
        stateManager.loadState(),
      ]);

      const results = await loads;

      // All loads should return the same state
      results.forEach(result => {
        expect(result).toEqual(testState);
      });
    });

    test('Handles concurrent save operations', async () => {
      const state1: SyncState = { 'file1.md': { localMtime: 1000, remoteMtime: 1500 } };
      const state2: SyncState = { 'file2.md': { localMtime: 2000, remoteMtime: 2500 } };
      const state3: SyncState = { 'file3.md': { localMtime: 3000, remoteMtime: 3500 } };

      // Start multiple save operations simultaneously
      await Promise.all([
        stateManager.saveState(state1),
        stateManager.saveState(state2),
        stateManager.saveState(state3),
      ]);

      // The last save should win (though order is not guaranteed)
      const finalState = await stateManager.loadState();
      expect(Object.keys(finalState)).toHaveLength(1);
    });
  });
});