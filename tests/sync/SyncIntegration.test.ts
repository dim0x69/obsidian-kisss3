import { SyncDecisionEngine } from '../../sync/SyncDecisionEngine';
import { SyncStateManager } from '../../sync/SyncStateManager';
import { 
  FileStatus, 
  SyncAction, 
  LocalFilesMap, 
  RemoteFilesMap, 
  StateFilesMap,
  LocalFile,
  RemoteFile,
  SyncFileState
} from '../../sync/SyncTypes';
import { MockApp } from '../mocks/MockObsidianApp';
import { MockPlugin } from '../mocks/MockPlugin';

describe('Sync Integration Tests', () => {
  let decisionEngine: SyncDecisionEngine;
  let stateManager: SyncStateManager;
  let mockApp: MockApp;
  let mockPlugin: MockPlugin;

  beforeEach(() => {
    mockApp = new MockApp();
    mockPlugin = new MockPlugin();
    decisionEngine = new SyncDecisionEngine(mockPlugin as any);
    stateManager = new SyncStateManager(mockApp as any, mockPlugin as any);
  });

  describe('Complete sync scenarios', () => {
    test('Initial sync with local files only', async () => {
      // Setup: Create local files
      const localFiles = new Map<string, LocalFile>([
        ['file1.md', { path: 'file1.md', mtime: 1000 }],
        ['file2.md', { path: 'file2.md', mtime: 1100 }],
        ['folder/file3.md', { path: 'folder/file3.md', mtime: 1200 }]
      ]);
      
      const remoteFiles = new Map<string, RemoteFile>();
      const stateFiles = new Map<string, SyncFileState>();

      // Execute decision engine
      const decisions = decisionEngine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);

      // Verify all files are marked for upload
      expect(decisions).toHaveLength(3);
      decisions.forEach(decision => {
        expect(decision.action).toBe(SyncAction.UPLOAD);
        expect(decision.localStatus).toBe(FileStatus.CREATED);
        expect(decision.remoteStatus).toBe(FileStatus.UNCHANGED);
      });

      // Simulate uploading and creating new state
      const newState: Record<string, SyncFileState> = {};
      decisions.forEach(decision => {
        if (decision.action === SyncAction.UPLOAD) {
          const localFile = localFiles.get(decision.filePath);
          if (localFile) {
            newState[decision.filePath] = {
              localMtime: localFile.mtime,
              remoteMtime: localFile.mtime + 100 // Simulate S3 timestamp
            };
          }
        }
      });

      // Save and load state
      await stateManager.saveState(newState);
      const loadedState = await stateManager.loadState();
      
      expect(loadedState['file1.md']).toEqual({
        localMtime: 1000,
        remoteMtime: 1100
      });
    });

    test('Sync with remote files downloaded', async () => {
      // Setup: Remote files exist, no local files
      const localFiles = new Map<string, LocalFile>();
      const remoteFiles = new Map<string, RemoteFile>([
        ['remote1.md', { path: 'remote1.md', mtime: 2000, key: 'remote1.md' }],
        ['remote2.md', { path: 'remote2.md', mtime: 2100, key: 'remote2.md' }]
      ]);
      const stateFiles = new Map<string, SyncFileState>();

      const decisions = decisionEngine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);

      // Verify all files are marked for download
      expect(decisions).toHaveLength(2);
      decisions.forEach(decision => {
        expect(decision.action).toBe(SyncAction.DOWNLOAD);
        expect(decision.localStatus).toBe(FileStatus.UNCHANGED);
        expect(decision.remoteStatus).toBe(FileStatus.CREATED);
      });
    });

    test('Sync with bidirectional changes', async () => {
      // Setup: Both local and remote changes
      const localFiles = new Map<string, LocalFile>([
        ['local-only.md', { path: 'local-only.md', mtime: 1000 }],
        ['both-changed.md', { path: 'both-changed.md', mtime: 2500 }],
        ['unchanged.md', { path: 'unchanged.md', mtime: 1500 }]
      ]);
      
      const remoteFiles = new Map<string, RemoteFile>([
        ['remote-only.md', { path: 'remote-only.md', mtime: 2000, key: 'remote-only.md' }],
        ['both-changed.md', { path: 'both-changed.md', mtime: 2300, key: 'both-changed.md' }],
        ['unchanged.md', { path: 'unchanged.md', mtime: 1800, key: 'unchanged.md' }]
      ]);
      
      const stateFiles = new Map<string, SyncFileState>([
        ['both-changed.md', { localMtime: 1500, remoteMtime: 1600 }],
        ['unchanged.md', { localMtime: 1500, remoteMtime: 1800 }]
      ]);

      const decisions = decisionEngine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);

      expect(decisions).toHaveLength(4);

      // Find specific decisions
      const localOnlyDecision = decisions.find(d => d.filePath === 'local-only.md');
      const remoteOnlyDecision = decisions.find(d => d.filePath === 'remote-only.md');
      const bothChangedDecision = decisions.find(d => d.filePath === 'both-changed.md');
      const unchangedDecision = decisions.find(d => d.filePath === 'unchanged.md');

      expect(localOnlyDecision?.action).toBe(SyncAction.UPLOAD);
      expect(remoteOnlyDecision?.action).toBe(SyncAction.DOWNLOAD);
      expect(bothChangedDecision?.action).toBe(SyncAction.UPLOAD); // Local newer
      expect(unchangedDecision?.action).toBe(SyncAction.DO_NOTHING);
    });

    test('Sync with deletions', async () => {
      // Setup: Files deleted on different sides
      const localFiles = new Map<string, LocalFile>([
        ['kept.md', { path: 'kept.md', mtime: 1500 }]
      ]);
      
      const remoteFiles = new Map<string, RemoteFile>([
        ['kept.md', { path: 'kept.md', mtime: 1800, key: 'kept.md' }]
      ]);
      
      const stateFiles = new Map<string, SyncFileState>([
        ['kept.md', { localMtime: 1500, remoteMtime: 1800 }],
        ['deleted-local.md', { localMtime: 1200, remoteMtime: 1300 }],
        ['deleted-remote.md', { localMtime: 1400, remoteMtime: 1350 }],
        ['deleted-both.md', { localMtime: 1100, remoteMtime: 1150 }]
      ]);

      // Add remote file that still exists for deleted-local case
      remoteFiles.set('deleted-local.md', { path: 'deleted-local.md', mtime: 1300, key: 'deleted-local.md' });
      
      // Add local file that still exists for deleted-remote case
      localFiles.set('deleted-remote.md', { path: 'deleted-remote.md', mtime: 1400 });

      const decisions = decisionEngine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);

      expect(decisions).toHaveLength(4);

      const keptDecision = decisions.find(d => d.filePath === 'kept.md');
      const deletedLocalDecision = decisions.find(d => d.filePath === 'deleted-local.md');
      const deletedRemoteDecision = decisions.find(d => d.filePath === 'deleted-remote.md');
      const deletedBothDecision = decisions.find(d => d.filePath === 'deleted-both.md');

      expect(keptDecision?.action).toBe(SyncAction.DO_NOTHING);
      expect(deletedLocalDecision?.action).toBe(SyncAction.DELETE_REMOTE);
      expect(deletedRemoteDecision?.action).toBe(SyncAction.DELETE_LOCAL);
      expect(deletedBothDecision?.action).toBe(SyncAction.DO_NOTHING);
    });

    test('Complex conflict scenarios', async () => {
      // Setup various conflict scenarios
      const localFiles = new Map<string, LocalFile>([
        ['mod-vs-del-local.md', { path: 'mod-vs-del-local.md', mtime: 2000 }],
        ['create-vs-del-local.md', { path: 'create-vs-del-local.md', mtime: 2100 }]
      ]);
      
      const remoteFiles = new Map<string, RemoteFile>([
        ['mod-vs-del-remote.md', { path: 'mod-vs-del-remote.md', mtime: 2200, key: 'mod-vs-del-remote.md' }],
        ['create-vs-del-remote.md', { path: 'create-vs-del-remote.md', mtime: 2300, key: 'create-vs-del-remote.md' }]
      ]);
      
      const stateFiles = new Map<string, SyncFileState>([
        ['mod-vs-del-local.md', { localMtime: 1500, remoteMtime: 1600 }], // Remote deleted, local modified
        ['mod-vs-del-remote.md', { localMtime: 1700, remoteMtime: 1800 }], // Local deleted, remote modified
        ['create-vs-del-local.md', { localMtime: undefined, remoteMtime: 1900 }], // Remote deleted, local created
        ['create-vs-del-remote.md', { localMtime: 2000, remoteMtime: undefined }] // Local deleted, remote created
      ]);

      const decisions = decisionEngine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);

      expect(decisions).toHaveLength(4);

      const modVsDelLocal = decisions.find(d => d.filePath === 'mod-vs-del-local.md');
      const modVsDelRemote = decisions.find(d => d.filePath === 'mod-vs-del-remote.md');
      const createVsDelLocal = decisions.find(d => d.filePath === 'create-vs-del-local.md');
      const createVsDelRemote = decisions.find(d => d.filePath === 'create-vs-del-remote.md');

      // Modification vs Deletion: Modification wins
      expect(modVsDelLocal?.action).toBe(SyncAction.UPLOAD);
      expect(modVsDelRemote?.action).toBe(SyncAction.DOWNLOAD);
      
      // Creation vs Deletion: Creation wins  
      expect(createVsDelLocal?.action).toBe(SyncAction.UPLOAD);
      expect(createVsDelRemote?.action).toBe(SyncAction.DOWNLOAD);
    });

    test('State persistence and recovery', async () => {
      // Test that state is properly saved and loaded
      const initialState = {
        'file1.md': { localMtime: 1000, remoteMtime: 1100 },
        'file2.md': { localMtime: 2000, remoteMtime: undefined },
        'file3.md': { localMtime: undefined, remoteMtime: 3000 }
      };

      await stateManager.saveState(initialState);
      const loadedState = await stateManager.loadState();

      expect(loadedState).toEqual(initialState);

      // Test state clearing
      await stateManager.clearState();
      const clearedState = await stateManager.loadState();
      
      expect(clearedState).toEqual({});
    });

    test('Large scale sync simulation', async () => {
      // Simulate syncing many files
      const localFiles = new Map<string, LocalFile>();
      const remoteFiles = new Map<string, RemoteFile>();
      const stateFiles = new Map<string, SyncFileState>();

      // Create 100 local files
      for (let i = 0; i < 100; i++) {
        localFiles.set(`local${i}.md`, { path: `local${i}.md`, mtime: 1000 + i });
      }

      // Create 100 remote files  
      for (let i = 0; i < 100; i++) {
        remoteFiles.set(`remote${i}.md`, { 
          path: `remote${i}.md`, 
          mtime: 2000 + i, 
          key: `remote${i}.md` 
        });
      }

      // Create some overlapping state
      for (let i = 50; i < 100; i++) {
        stateFiles.set(`local${i}.md`, { localMtime: 1000 + i - 50, remoteMtime: undefined });
        stateFiles.set(`remote${i}.md`, { localMtime: undefined, remoteMtime: 2000 + i - 50 });
      }

      const decisions = decisionEngine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);

      // Should have decisions for all unique files
      expect(decisions.length).toBeGreaterThan(150); // 100 local + 100 remote - overlaps

      // Verify decision types
      const uploads = decisions.filter(d => d.action === SyncAction.UPLOAD);
      const downloads = decisions.filter(d => d.action === SyncAction.DOWNLOAD);
      
      expect(uploads.length).toBeGreaterThan(0);
      expect(downloads.length).toBeGreaterThan(0);
    });
  });

  describe('Edge cases', () => {
    test('Files with same name but different extensions', async () => {
      const localFiles = new Map<string, LocalFile>([
        ['document.md', { path: 'document.md', mtime: 1000 }],
        ['document.txt', { path: 'document.txt', mtime: 1100 }]
      ]);
      
      const remoteFiles = new Map<string, RemoteFile>([
        ['document.pdf', { path: 'document.pdf', mtime: 1200, key: 'document.pdf' }]
      ]);
      
      const stateFiles = new Map<string, SyncFileState>();

      const decisions = decisionEngine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);

      expect(decisions).toHaveLength(3);
      decisions.forEach(decision => {
        if (decision.filePath.endsWith('.md') || decision.filePath.endsWith('.txt')) {
          expect(decision.action).toBe(SyncAction.UPLOAD);
        } else if (decision.filePath.endsWith('.pdf')) {
          expect(decision.action).toBe(SyncAction.DOWNLOAD);
        }
      });
    });

    test('Deeply nested folder structures', async () => {
      const localFiles = new Map<string, LocalFile>([
        ['a/b/c/d/e/deep.md', { path: 'a/b/c/d/e/deep.md', mtime: 1000 }]
      ]);
      
      const remoteFiles = new Map<string, RemoteFile>([
        ['x/y/z/nested.md', { path: 'x/y/z/nested.md', mtime: 2000, key: 'x/y/z/nested.md' }]
      ]);
      
      const stateFiles = new Map<string, SyncFileState>();

      const decisions = decisionEngine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);

      expect(decisions).toHaveLength(2);
      
      const deepDecision = decisions.find(d => d.filePath === 'a/b/c/d/e/deep.md');
      const nestedDecision = decisions.find(d => d.filePath === 'x/y/z/nested.md');

      expect(deepDecision?.action).toBe(SyncAction.UPLOAD);
      expect(nestedDecision?.action).toBe(SyncAction.DOWNLOAD);
    });

    test('Files with special characters in names', async () => {
      const localFiles = new Map<string, LocalFile>([
        ['file with spaces.md', { path: 'file with spaces.md', mtime: 1000 }],
        ['file-with-dashes.md', { path: 'file-with-dashes.md', mtime: 1100 }],
        ['file_with_underscores.md', { path: 'file_with_underscores.md', mtime: 1200 }]
      ]);
      
      const remoteFiles = new Map<string, RemoteFile>();
      const stateFiles = new Map<string, SyncFileState>();

      const decisions = decisionEngine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);

      expect(decisions).toHaveLength(3);
      decisions.forEach(decision => {
        expect(decision.action).toBe(SyncAction.UPLOAD);
        expect(decision.filePath).toMatch(/^file/);
      });
    });
  });
});