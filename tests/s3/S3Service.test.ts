import { S3Service } from '../../s3/S3Service';
import { S3SyncSettings } from '../../settings';
import { MockTFile } from '../mocks/MockObsidianApp';
import { MockPlugin } from '../mocks/MockPlugin';

// Mock AWS SDK
const mockListObjectsV2Command = jest.fn();
const mockGetObjectCommand = jest.fn();
const mockPutObjectCommand = jest.fn();
const mockDeleteObjectCommand = jest.fn();
const mockHeadObjectCommand = jest.fn();
const mockS3ClientSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: mockS3ClientSend,
  })),
  ListObjectsV2Command: jest.fn().mockImplementation((params) => {
    mockListObjectsV2Command(params);
    return { params };
  }),
  GetObjectCommand: jest.fn().mockImplementation((params) => {
    mockGetObjectCommand(params);
    return { params };
  }),
  PutObjectCommand: jest.fn().mockImplementation((params) => {
    mockPutObjectCommand(params);
    return { params };
  }),
  DeleteObjectCommand: jest.fn().mockImplementation((params) => {
    mockDeleteObjectCommand(params);
    return { params };
  }),
  HeadObjectCommand: jest.fn().mockImplementation((params) => {
    mockHeadObjectCommand(params);
    return { params };
  }),
}));

describe('S3Service', () => {
  let s3Service: S3Service;
  let mockPlugin: MockPlugin;
  let settings: S3SyncSettings;

  beforeEach(() => {
    mockPlugin = new MockPlugin();
    settings = {
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      bucketName: 'test-bucket',
      region: 'us-east-1',
      endpoint: 'https://s3.amazonaws.com',
      remotePrefix: '',
      syncIntervalMinutes: 15,
      enableAutomaticSync: false,
      enableDebugLogging: false,
    };
    s3Service = new S3Service(settings, mockPlugin as any);
    
    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('Configuration', () => {
    test('Service is configured with valid settings', () => {
      expect(s3Service.isConfigured()).toBe(true);
    });

    test('Service is not configured with missing settings', () => {
      const incompleteSettings = {
        ...settings,
        accessKeyId: '',
      };
      const incompleteService = new S3Service(incompleteSettings, mockPlugin as any);
      expect(incompleteService.isConfigured()).toBe(false);
    });

    test('Settings can be updated', () => {
      const newSettings = {
        ...settings,
        bucketName: 'new-bucket',
      };
      s3Service.updateSettings(newSettings);
      expect(s3Service.isConfigured()).toBe(true);
    });

    test('Invalid settings update makes service unconfigured', () => {
      const invalidSettings = {
        ...settings,
        secretAccessKey: '',
      };
      s3Service.updateSettings(invalidSettings);
      expect(s3Service.isConfigured()).toBe(false);
    });
  });

  describe('Remote key/path conversion', () => {
    test('Converts local path to remote key without prefix', () => {
      const service = new S3Service({ ...settings, remotePrefix: '' }, mockPlugin as any);
      
      // Use reflection to test private method behavior through public methods
      mockS3ClientSend.mockResolvedValue({
        Contents: [],
        IsTruncated: false,
      });

      service.listRemoteFiles();
      
      const listCall = mockListObjectsV2Command.mock.calls[0][0];
      expect(listCall.Prefix).toBe('');
    });

    test('Converts local path to remote key with prefix', () => {
      const service = new S3Service({ ...settings, remotePrefix: 'vault' }, mockPlugin as any);
      
      mockS3ClientSend.mockResolvedValue({
        Contents: [],
        IsTruncated: false,
      });

      service.listRemoteFiles();
      
      const listCall = mockListObjectsV2Command.mock.calls[0][0];
      expect(listCall.Prefix).toBe('vault');
    });

    test('Converts local path to remote key with prefix ending with slash', () => {
      const service = new S3Service({ ...settings, remotePrefix: 'vault/' }, mockPlugin as any);
      
      mockS3ClientSend.mockResolvedValue({
        Contents: [],
        IsTruncated: false,
      });

      service.listRemoteFiles();
      
      const listCall = mockListObjectsV2Command.mock.calls[0][0];
      expect(listCall.Prefix).toBe('vault/');
    });
  });

  describe('List remote files', () => {
    test('Lists files successfully', async () => {
      const mockObjects = [
        {
          Key: 'test1.md',
          LastModified: new Date('2024-01-15T10:00:00Z'),
          Size: 100,
        },
        {
          Key: 'folder/test2.md',
          LastModified: new Date('2024-01-15T11:00:00Z'),
          Size: 200,
        },
      ];

      mockS3ClientSend.mockResolvedValue({
        Contents: mockObjects,
        IsTruncated: false,
      });

      const result = await s3Service.listRemoteFiles();

      expect(result.size).toBe(2);
      expect(result.has('test1.md')).toBe(true);
      expect(result.has('folder/test2.md')).toBe(true);
      
      const file1 = result.get('test1.md')!;
      expect(file1.Key).toBe('test1.md');
      expect(file1.LastModified).toEqual(new Date('2024-01-15T10:00:00Z'));
    });

    test('Handles pagination', async () => {
      const firstBatch = [
        {
          Key: 'test1.md',
          LastModified: new Date('2024-01-15T10:00:00Z'),
          Size: 100,
        },
      ];

      const secondBatch = [
        {
          Key: 'test2.md',
          LastModified: new Date('2024-01-15T11:00:00Z'),
          Size: 200,
        },
      ];

      mockS3ClientSend
        .mockResolvedValueOnce({
          Contents: firstBatch,
          IsTruncated: true,
          NextContinuationToken: 'token123',
        })
        .mockResolvedValueOnce({
          Contents: secondBatch,
          IsTruncated: false,
        });

      const result = await s3Service.listRemoteFiles();

      expect(mockS3ClientSend).toHaveBeenCalledTimes(2);
      expect(result.size).toBe(2);
      expect(result.has('test1.md')).toBe(true);
      expect(result.has('test2.md')).toBe(true);
    });

    test('Excludes hidden files and folders', async () => {
      const mockObjects = [
        {
          Key: 'visible.md',
          LastModified: new Date('2024-01-15T10:00:00Z'),
          Size: 100,
        },
        {
          Key: '.hidden.md',
          LastModified: new Date('2024-01-15T10:00:00Z'),
          Size: 100,
        },
        {
          Key: 'folder/.hidden-in-folder.md',
          LastModified: new Date('2024-01-15T10:00:00Z'),
          Size: 100,
        },
      ];

      mockS3ClientSend.mockResolvedValue({
        Contents: mockObjects,
        IsTruncated: false,
      });

      const result = await s3Service.listRemoteFiles();

      expect(result.size).toBe(1);
      expect(result.has('visible.md')).toBe(true);
      expect(result.has('.hidden.md')).toBe(false);
      expect(result.has('folder/.hidden-in-folder.md')).toBe(false);
    });

    test('Excludes folder marker objects', async () => {
      const serviceWithPrefix = new S3Service({
        ...settings,
        remotePrefix: 'vault/',
      }, mockPlugin as any);
      
      const mockObjects = [
        {
          Key: 'vault/',
          LastModified: new Date('2024-01-15T10:00:00Z'),
          Size: 0,
        },
        {
          Key: 'vault/folder/file.md',
          LastModified: new Date('2024-01-15T10:00:00Z'),
          Size: 100,
        },
      ];

      mockS3ClientSend.mockResolvedValue({
        Contents: mockObjects,
        IsTruncated: false,
      });

      const result = await serviceWithPrefix.listRemoteFiles();

      expect(result.size).toBe(1);
      expect(result.has('folder/file.md')).toBe(true);
      expect(result.has('')).toBe(false); // The root folder marker would be converted to empty string
    });

    test('Handles empty bucket', async () => {
      mockS3ClientSend.mockResolvedValue({
        Contents: [],
        IsTruncated: false,
      });

      const result = await s3Service.listRemoteFiles();

      expect(result.size).toBe(0);
    });

    test('Throws error when not configured', async () => {
      const unconfiguredService = new S3Service({
        ...settings,
        accessKeyId: '',
      }, mockPlugin as any);

      await expect(unconfiguredService.listRemoteFiles()).rejects.toThrow('S3 client not configured');
    });
  });

  describe('Upload file', () => {
    test('Uploads file successfully', async () => {
      const testFile = new MockTFile('test.md', 1642248000000); // 2022-01-15T10:00:00Z
      const testContent = new TextEncoder().encode('test content').buffer;
      const mockLastModified = new Date('2024-01-15T10:05:00Z');

      mockS3ClientSend
        .mockResolvedValueOnce({}) // PutObject response
        .mockResolvedValueOnce({ // HeadObject response
          LastModified: mockLastModified,
        });

      const result = await s3Service.uploadFile(testFile, testContent);

      expect(mockPutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test.md',
        Body: expect.any(Uint8Array),
        ContentLength: testContent.byteLength,
        ContentType: 'application/octet-stream',
      });

      expect(mockHeadObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test.md',
      });

      expect(result).toBe(mockLastModified.getTime());
    });

    test('Uploads file with remote prefix', async () => {
      const serviceWithPrefix = new S3Service({
        ...settings,
        remotePrefix: 'vault',
      }, mockPlugin as any);
      
      const testFile = new MockTFile('folder/test.md', Date.now());
      const testContent = new ArrayBuffer(0);

      mockS3ClientSend
        .mockResolvedValueOnce({}) // PutObject response
        .mockResolvedValueOnce({ // HeadObject response
          LastModified: new Date(),
        });

      await serviceWithPrefix.uploadFile(testFile, testContent);

      expect(mockPutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: 'vault/folder/test.md',
        })
      );
    });

    test('Throws error when not configured', async () => {
      const unconfiguredService = new S3Service({
        ...settings,
        accessKeyId: '',
      }, mockPlugin as any);

      const testFile = new MockTFile('test.md');
      const testContent = new ArrayBuffer(0);

      await expect(unconfiguredService.uploadFile(testFile, testContent)).rejects.toThrow('S3 client not configured');
    });

    test('Handles upload failure', async () => {
      const testFile = new MockTFile('test.md');
      const testContent = new ArrayBuffer(0);

      mockS3ClientSend.mockRejectedValue(new Error('Upload failed'));

      await expect(s3Service.uploadFile(testFile, testContent)).rejects.toThrow('Upload failed');
    });
  });

  describe('Download file', () => {
    test('Downloads file successfully', async () => {
      const testContent = new TextEncoder().encode('downloaded content');
      const mockS3Object = {
        Key: 'test.md',
        LastModified: new Date(),
      };

      mockS3ClientSend.mockResolvedValue({
        Body: {
          transformToByteArray: () => Promise.resolve(testContent),
        },
      });

      const result = await s3Service.downloadFile(mockS3Object);

      expect(mockGetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test.md',
      });

      expect(result).toBeInstanceOf(ArrayBuffer);
      expect(new Uint8Array(result)).toEqual(testContent);
    });

    test('Handles empty file', async () => {
      const mockS3Object = {
        Key: 'empty.md',
        LastModified: new Date(),
      };

      mockS3ClientSend.mockResolvedValue({
        Body: null,
      });

      const result = await s3Service.downloadFile(mockS3Object);

      expect(result).toBeInstanceOf(ArrayBuffer);
      expect(result.byteLength).toBe(0);
    });

    test('Throws error when not configured', async () => {
      const unconfiguredService = new S3Service({
        ...settings,
        accessKeyId: '',
      }, mockPlugin as any);

      const mockS3Object = {
        Key: 'test.md',
        LastModified: new Date(),
      };

      await expect(unconfiguredService.downloadFile(mockS3Object)).rejects.toThrow('S3 client not configured');
    });
  });

  describe('Delete remote file', () => {
    test('Deletes file successfully', async () => {
      mockS3ClientSend.mockResolvedValue({});

      await s3Service.deleteRemoteFile('test.md');

      expect(mockDeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test.md',
      });
    });

    test('Deletes file with remote prefix', async () => {
      const serviceWithPrefix = new S3Service({
        ...settings,
        remotePrefix: 'vault/',
      }, mockPlugin as any);

      mockS3ClientSend.mockResolvedValue({});

      await serviceWithPrefix.deleteRemoteFile('folder/test.md');

      expect(mockDeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'vault/folder/test.md',
      });
    });

    test('Throws error when not configured', async () => {
      const unconfiguredService = new S3Service({
        ...settings,
        accessKeyId: '',
      }, mockPlugin as any);

      await expect(unconfiguredService.deleteRemoteFile('test.md')).rejects.toThrow('S3 client not configured');
    });
  });

  describe('Get file metadata', () => {
    test('Gets metadata successfully', async () => {
      const mockLastModified = new Date('2024-01-15T10:05:00Z');

      mockS3ClientSend.mockResolvedValue({
        LastModified: mockLastModified,
      });

      const result = await s3Service.getFileMetadata('test.md');

      expect(mockHeadObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test.md',
      });

      expect(result).toBe(mockLastModified.getTime());
    });

    test('Handles missing LastModified', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      mockS3ClientSend.mockResolvedValue({
        LastModified: undefined,
      });

      const result = await s3Service.getFileMetadata('test.md');

      expect(consoleSpy).toHaveBeenCalledWith('LastModified not available for test.md');
      expect(result).toBeCloseTo(Date.now(), -2); // Within 100ms of current time

      consoleSpy.mockRestore();
    });

    test('Throws error when not configured', async () => {
      const unconfiguredService = new S3Service({
        ...settings,
        accessKeyId: '',
      }, mockPlugin as any);

      await expect(unconfiguredService.getFileMetadata('test.md')).rejects.toThrow('S3 client not configured');
    });
  });

  describe('Debug logging', () => {
    test('Debug logs are called when enabled', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const serviceWithDebug = new S3Service({
        ...settings,
        enableDebugLogging: true,
      }, { ...mockPlugin, settings: { ...mockPlugin.settings, enableDebugLogging: true } } as any);

      mockS3ClientSend.mockResolvedValue({
        Contents: [],
        IsTruncated: false,
      });

      await serviceWithDebug.listRemoteFiles();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    test('Debug logs are not called when disabled', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      mockS3ClientSend.mockResolvedValue({
        Contents: [],
        IsTruncated: false,
      });

      await s3Service.listRemoteFiles();

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});