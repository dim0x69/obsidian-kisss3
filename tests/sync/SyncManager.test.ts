import { SyncManager } from '../../sync/SyncManager';
import { MockApp } from '../mocks/MockObsidianApp';
import { MockPlugin } from '../mocks/MockPlugin';

describe('SyncManager', () => {
  let syncManager: SyncManager;
  let mockApp: MockApp;
  let mockPlugin: MockPlugin;

  beforeEach(() => {
    mockApp = new MockApp();
    mockPlugin = new MockPlugin();
    syncManager = new SyncManager(mockApp as any, mockPlugin as any);
  });

  describe('Basic functionality', () => {
    test('SyncManager can be instantiated', () => {
      expect(syncManager).toBeDefined();
      expect(syncManager).toBeInstanceOf(SyncManager);
    });

    test('Settings can be updated', () => {
      const newSettings = {
        ...mockPlugin.settings,
        bucketName: 'new-bucket',
      };

      // This should not throw
      expect(() => syncManager.updateSettings(newSettings)).not.toThrow();
    });

    test('Sync fails gracefully when S3 is not configured', () => {
      // Mock plugin with incomplete settings
      const incompletePlugin = new MockPlugin({
        accessKeyId: '', // Missing required setting
      });
      const managerWithIncompleteSettings = new SyncManager(mockApp as any, incompletePlugin as any);
      
      // Should not throw when calling runSync
      expect(() => managerWithIncompleteSettings.runSync()).not.toThrow();
    });
  });

  describe('File exclusion logic', () => {
    test('shouldIgnoreFile correctly identifies hidden files', () => {
      // Access private method through reflection for testing
      const shouldIgnore = (syncManager as any).shouldIgnoreFile.bind(syncManager);
      
      expect(shouldIgnore('.hidden')).toBe(true);
      expect(shouldIgnore('folder/.hidden')).toBe(true);
      expect(shouldIgnore('.obsidian/config')).toBe(true);
      expect(shouldIgnore('normal-file.md')).toBe(false);
      expect(shouldIgnore('folder/normal-file.md')).toBe(false);
    });
  });
});