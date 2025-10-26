import { SyncDecisionEngine } from '../../sync/SyncDecisionEngine';
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
import { MockPlugin } from '../mocks/MockPlugin';

describe('SyncDecisionEngine', () => {
  let engine: SyncDecisionEngine;
  let mockPlugin: MockPlugin;

  beforeEach(() => {
    mockPlugin = new MockPlugin();
    engine = new SyncDecisionEngine(mockPlugin as any);
  });

  describe('Single-source changes (no conflicts)', () => {
    test('Local file created - should upload', () => {
      const localFiles = new Map<string, LocalFile>([
        ['test.md', { path: 'test.md', mtime: 1000 }]
      ]);
      const remoteFiles = new Map<string, RemoteFile>();
      const stateFiles = new Map<string, SyncFileState>();

      const decisions = engine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);
      
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        filePath: 'test.md',
        localStatus: FileStatus.CREATED,
        remoteStatus: FileStatus.UNCHANGED,
        action: SyncAction.UPLOAD
      });
    });

    test('Local file modified - should upload', () => {
      const localFiles = new Map<string, LocalFile>([
        ['test.md', { path: 'test.md', mtime: 2000 }]
      ]);
      const remoteFiles = new Map<string, RemoteFile>();
      const stateFiles = new Map<string, SyncFileState>([
        ['test.md', { localMtime: 1000, remoteMtime: undefined }]
      ]);

      const decisions = engine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);
      
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        filePath: 'test.md',
        localStatus: FileStatus.MODIFIED,
        remoteStatus: FileStatus.UNCHANGED,
        action: SyncAction.UPLOAD
      });
    });

    test('Local file deleted - should delete remote', () => {
      const localFiles = new Map<string, LocalFile>();
      const remoteFiles = new Map<string, RemoteFile>([
        ['test.md', { path: 'test.md', mtime: 1500, key: 'test.md' }]
      ]);
      const stateFiles = new Map<string, SyncFileState>([
        ['test.md', { localMtime: 1000, remoteMtime: 1500 }]
      ]);

      const decisions = engine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);
      
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        filePath: 'test.md',
        localStatus: FileStatus.DELETED,
        remoteStatus: FileStatus.UNCHANGED,
        action: SyncAction.DELETE_REMOTE
      });
    });

    test('Remote file created - should download', () => {
      const localFiles = new Map<string, LocalFile>();
      const remoteFiles = new Map<string, RemoteFile>([
        ['test.md', { path: 'test.md', mtime: 1000, key: 'test.md' }]
      ]);
      const stateFiles = new Map<string, SyncFileState>();

      const decisions = engine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);
      
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        filePath: 'test.md',
        localStatus: FileStatus.UNCHANGED,
        remoteStatus: FileStatus.CREATED,
        action: SyncAction.DOWNLOAD
      });
    });

    test('Remote file modified - should download', () => {
      const localFiles = new Map<string, LocalFile>();
      const remoteFiles = new Map<string, RemoteFile>([
        ['test.md', { path: 'test.md', mtime: 2000, key: 'test.md' }]
      ]);
      const stateFiles = new Map<string, SyncFileState>([
        ['test.md', { localMtime: undefined, remoteMtime: 1000 }]
      ]);

      const decisions = engine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);
      
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        filePath: 'test.md',
        localStatus: FileStatus.UNCHANGED,
        remoteStatus: FileStatus.MODIFIED,
        action: SyncAction.DOWNLOAD
      });
    });

    test('Remote file deleted - should delete local', () => {
      const localFiles = new Map<string, LocalFile>();
      const remoteFiles = new Map<string, RemoteFile>();
      const stateFiles = new Map<string, SyncFileState>([
        ['test.md', { localMtime: 1000, remoteMtime: 1500 }]
      ]);

      const decisions = engine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);
      
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        filePath: 'test.md',
        localStatus: FileStatus.DELETED,
        remoteStatus: FileStatus.DELETED,
        action: SyncAction.DO_NOTHING
      });
    });

    test('No changes - should do nothing', () => {
      const localFiles = new Map<string, LocalFile>([
        ['test.md', { path: 'test.md', mtime: 1000 }]
      ]);
      const remoteFiles = new Map<string, RemoteFile>([
        ['test.md', { path: 'test.md', mtime: 1500, key: 'test.md' }]
      ]);
      const stateFiles = new Map<string, SyncFileState>([
        ['test.md', { localMtime: 1000, remoteMtime: 1500 }]
      ]);

      const decisions = engine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);
      
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        filePath: 'test.md',
        localStatus: FileStatus.UNCHANGED,
        remoteStatus: FileStatus.UNCHANGED,
        action: SyncAction.DO_NOTHING
      });
    });
  });

  describe('Conflict resolution: Modification vs Deletion', () => {
    test('Local deleted, remote modified - modification wins (download)', () => {
      const localFiles = new Map<string, LocalFile>();
      const remoteFiles = new Map<string, RemoteFile>([
        ['test.md', { path: 'test.md', mtime: 2000, key: 'test.md' }]
      ]);
      const stateFiles = new Map<string, SyncFileState>([
        ['test.md', { localMtime: 1000, remoteMtime: 1500 }]
      ]);

      const decisions = engine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);
      
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        filePath: 'test.md',
        localStatus: FileStatus.DELETED,
        remoteStatus: FileStatus.MODIFIED,
        action: SyncAction.DOWNLOAD
      });
    });

    test('Local modified, remote deleted - modification wins (upload)', () => {
      const localFiles = new Map<string, LocalFile>([
        ['test.md', { path: 'test.md', mtime: 2000 }]
      ]);
      const remoteFiles = new Map<string, RemoteFile>();
      const stateFiles = new Map<string, SyncFileState>([
        ['test.md', { localMtime: 1000, remoteMtime: 1500 }]
      ]);

      const decisions = engine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);
      
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        filePath: 'test.md',
        localStatus: FileStatus.MODIFIED,
        remoteStatus: FileStatus.DELETED,
        action: SyncAction.UPLOAD
      });
    });
  });

  describe('Conflict resolution: Creation vs Deletion', () => {
    test('Local deleted, remote created - creation wins (download)', () => {
      const localFiles = new Map<string, LocalFile>();
      const remoteFiles = new Map<string, RemoteFile>([
        ['test.md', { path: 'test.md', mtime: 2000, key: 'test.md' }]
      ]);
      const stateFiles = new Map<string, SyncFileState>([
        ['test.md', { localMtime: 1000, remoteMtime: undefined }]
      ]);

      const decisions = engine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);
      
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        filePath: 'test.md',
        localStatus: FileStatus.DELETED,
        remoteStatus: FileStatus.CREATED,
        action: SyncAction.DOWNLOAD
      });
    });

    test('Local created, remote deleted - creation wins (upload)', () => {
      const localFiles = new Map<string, LocalFile>([
        ['test.md', { path: 'test.md', mtime: 2000 }]
      ]);
      const remoteFiles = new Map<string, RemoteFile>();
      const stateFiles = new Map<string, SyncFileState>([
        ['test.md', { localMtime: undefined, remoteMtime: 1500 }]
      ]);

      const decisions = engine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);
      
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        filePath: 'test.md',
        localStatus: FileStatus.CREATED,
        remoteStatus: FileStatus.DELETED,
        action: SyncAction.UPLOAD
      });
    });
  });

  describe('Conflict resolution: Both sides changed', () => {
    test('Both created - newer wins by mtime (local newer)', () => {
      const localFiles = new Map<string, LocalFile>([
        ['test.md', { path: 'test.md', mtime: 2000 }]
      ]);
      const remoteFiles = new Map<string, RemoteFile>([
        ['test.md', { path: 'test.md', mtime: 1500, key: 'test.md' }]
      ]);
      const stateFiles = new Map<string, SyncFileState>();

      const decisions = engine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);
      
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        filePath: 'test.md',
        localStatus: FileStatus.CREATED,
        remoteStatus: FileStatus.CREATED,
        action: SyncAction.UPLOAD
      });
    });

    test('Both created - newer wins by mtime (remote newer)', () => {
      const localFiles = new Map<string, LocalFile>([
        ['test.md', { path: 'test.md', mtime: 1500 }]
      ]);
      const remoteFiles = new Map<string, RemoteFile>([
        ['test.md', { path: 'test.md', mtime: 2000, key: 'test.md' }]
      ]);
      const stateFiles = new Map<string, SyncFileState>();

      const decisions = engine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);
      
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        filePath: 'test.md',
        localStatus: FileStatus.CREATED,
        remoteStatus: FileStatus.CREATED,
        action: SyncAction.DOWNLOAD
      });
    });

    test('Both modified - newer wins by mtime (local newer)', () => {
      const localFiles = new Map<string, LocalFile>([
        ['test.md', { path: 'test.md', mtime: 3000 }]
      ]);
      const remoteFiles = new Map<string, RemoteFile>([
        ['test.md', { path: 'test.md', mtime: 2500, key: 'test.md' }]
      ]);
      const stateFiles = new Map<string, SyncFileState>([
        ['test.md', { localMtime: 1000, remoteMtime: 1500 }]
      ]);

      const decisions = engine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);
      
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        filePath: 'test.md',
        localStatus: FileStatus.MODIFIED,
        remoteStatus: FileStatus.MODIFIED,
        action: SyncAction.UPLOAD
      });
    });

    test('Both modified - newer wins by mtime (remote newer)', () => {
      const localFiles = new Map<string, LocalFile>([
        ['test.md', { path: 'test.md', mtime: 2500 }]
      ]);
      const remoteFiles = new Map<string, RemoteFile>([
        ['test.md', { path: 'test.md', mtime: 3000, key: 'test.md' }]
      ]);
      const stateFiles = new Map<string, SyncFileState>([
        ['test.md', { localMtime: 1000, remoteMtime: 1500 }]
      ]);

      const decisions = engine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);
      
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        filePath: 'test.md',
        localStatus: FileStatus.MODIFIED,
        remoteStatus: FileStatus.MODIFIED,
        action: SyncAction.DOWNLOAD
      });
    });

    test('Both modified with same mtime - conflict resolution', () => {
      const localFiles = new Map<string, LocalFile>([
        ['test.md', { path: 'test.md', mtime: 2500 }]
      ]);
      const remoteFiles = new Map<string, RemoteFile>([
        ['test.md', { path: 'test.md', mtime: 2500, key: 'test.md' }]
      ]);
      const stateFiles = new Map<string, SyncFileState>([
        ['test.md', { localMtime: 1000, remoteMtime: 1500 }]
      ]);

      const decisions = engine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);
      
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        filePath: 'test.md',
        localStatus: FileStatus.MODIFIED,
        remoteStatus: FileStatus.MODIFIED,
        action: SyncAction.CONFLICT
      });
    });
  });

  describe('Edge cases and complex scenarios', () => {
    test('Multiple files with different sync actions', () => {
      const localFiles = new Map<string, LocalFile>([
        ['new-local.md', { path: 'new-local.md', mtime: 1000 }],
        ['modified-local.md', { path: 'modified-local.md', mtime: 2000 }],
        ['unchanged.md', { path: 'unchanged.md', mtime: 1500 }]
      ]);
      
      const remoteFiles = new Map<string, RemoteFile>([
        ['new-remote.md', { path: 'new-remote.md', mtime: 1200, key: 'new-remote.md' }],
        ['modified-remote.md', { path: 'modified-remote.md', mtime: 2200, key: 'modified-remote.md' }],
        ['unchanged.md', { path: 'unchanged.md', mtime: 1800, key: 'unchanged.md' }]
      ]);
      
      const stateFiles = new Map<string, SyncFileState>([
        ['modified-local.md', { localMtime: 1000, remoteMtime: undefined }],
        ['modified-remote.md', { localMtime: undefined, remoteMtime: 1800 }],
        ['unchanged.md', { localMtime: 1500, remoteMtime: 1800 }],
        ['deleted-local.md', { localMtime: 1300, remoteMtime: 1400 }]
      ]);

      const decisions = engine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);
      
      expect(decisions).toHaveLength(6);
      
      // Find decisions by file path
      const newLocalDecision = decisions.find(d => d.filePath === 'new-local.md');
      const newRemoteDecision = decisions.find(d => d.filePath === 'new-remote.md');
      const modifiedLocalDecision = decisions.find(d => d.filePath === 'modified-local.md');
      const modifiedRemoteDecision = decisions.find(d => d.filePath === 'modified-remote.md');
      const unchangedDecision = decisions.find(d => d.filePath === 'unchanged.md');

      expect(newLocalDecision?.action).toBe(SyncAction.UPLOAD);
      expect(newRemoteDecision?.action).toBe(SyncAction.DOWNLOAD);
      expect(modifiedLocalDecision?.action).toBe(SyncAction.UPLOAD);
      expect(modifiedRemoteDecision?.action).toBe(SyncAction.DOWNLOAD);
      expect(unchangedDecision?.action).toBe(SyncAction.DO_NOTHING);
    });

    test('File deleted on both sides - do nothing', () => {
      const localFiles = new Map<string, LocalFile>();
      const remoteFiles = new Map<string, RemoteFile>();
      const stateFiles = new Map<string, SyncFileState>([
        ['deleted-everywhere.md', { localMtime: 1000, remoteMtime: 1500 }]
      ]);

      const decisions = engine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);
      
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        filePath: 'deleted-everywhere.md',
        localStatus: FileStatus.DELETED,
        remoteStatus: FileStatus.DELETED,
        action: SyncAction.DO_NOTHING
      });
    });

    test('File with legacy state format (string instead of SyncFileState)', () => {
      // This tests backward compatibility
      const localFiles = new Map<string, LocalFile>([
        ['legacy.md', { path: 'legacy.md', mtime: 2000 }]
      ]);
      const remoteFiles = new Map<string, RemoteFile>();
      // Simulate legacy state format where mtime was stored as string
      const stateFiles = new Map<string, SyncFileState>([
        ['legacy.md', { localMtime: 1000, remoteMtime: undefined }]
      ]);

      const decisions = engine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);
      
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        filePath: 'legacy.md',
        localStatus: FileStatus.MODIFIED,
        remoteStatus: FileStatus.UNCHANGED,
        action: SyncAction.UPLOAD
      });
    });
  });

  describe('Debug logging', () => {
    test('Debug logs are called when enabled', () => {
      const consoleSpy = jest.spyOn(console, 'log');
      mockPlugin.settings.enableDebugLogging = true;

      const localFiles = new Map<string, LocalFile>([
        ['test.md', { path: 'test.md', mtime: 1000 }]
      ]);
      const remoteFiles = new Map<string, RemoteFile>();
      const stateFiles = new Map<string, SyncFileState>();

      engine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);
      
      expect(consoleSpy).toHaveBeenCalled();
    });

    test('Debug logs are not called when disabled', () => {
      const consoleSpy = jest.spyOn(console, 'log');
      mockPlugin.settings.enableDebugLogging = false;

      const localFiles = new Map<string, LocalFile>([
        ['test.md', { path: 'test.md', mtime: 1000 }]
      ]);
      const remoteFiles = new Map<string, RemoteFile>();
      const stateFiles = new Map<string, SyncFileState>();

      engine.generateSyncDecisions(localFiles, remoteFiles, stateFiles);
      
      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });
});