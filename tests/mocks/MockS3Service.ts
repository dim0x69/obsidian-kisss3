import { _Object as S3Object } from '@aws-sdk/client-s3';
import { TFile } from 'obsidian';

export interface MockS3Object {
  Key: string;
  LastModified: Date;
  Size?: number;
  content: ArrayBuffer;
}

export class MockS3Service {
  private objects: Map<string, MockS3Object> = new Map();
  private configured = true;
  private settings: any = {
    bucketName: 'test-bucket',
    remotePrefix: '',
    enableDebugLogging: false,
  };

  constructor(settings?: any) {
    if (settings) {
      this.settings = { ...this.settings, ...settings };
    }
  }

  // Mock configuration
  isConfigured(): boolean {
    return this.configured;
  }

  setConfigured(configured: boolean): void {
    this.configured = configured;
  }

  updateSettings(settings: any): void {
    this.settings = { ...this.settings, ...settings };
  }

  // Helper methods for test setup
  addRemoteFile(path: string, lastModified: Date, content: ArrayBuffer = new ArrayBuffer(0)): void {
    const key = this.getRemoteKey(path);
    this.objects.set(key, {
      Key: key,
      LastModified: lastModified,
      Size: content.byteLength,
      content: content,
    });
  }

  removeRemoteFile(path: string): void {
    const key = this.getRemoteKey(path);
    this.objects.delete(key);
  }

  clearRemoteFiles(): void {
    this.objects.clear();
  }

  getRemoteFiles(): Map<string, MockS3Object> {
    return new Map(this.objects);
  }

  // Mock S3Service methods
  private getRemoteKey(localPath: string): string {
    const prefix = this.settings.remotePrefix.trim();
    if (prefix && !prefix.endsWith('/')) {
      return `${prefix}/${localPath}`;
    }
    return `${prefix}${localPath}`;
  }

  private getLocalPath(remoteKey: string): string {
    const prefix = this.settings.remotePrefix.trim();
    if (prefix && !prefix.endsWith('/')) {
      return remoteKey.substring(prefix.length + 1);
    }
    return remoteKey.substring(prefix.length);
  }

  private shouldIgnoreFile(filePath: string): boolean {
    return filePath.split('/').some(part => part.startsWith('.'));
  }

  async listRemoteFiles(): Promise<Map<string, S3Object>> {
    const remoteFiles = new Map<string, S3Object>();
    
    for (const [key, mockObj] of this.objects) {
      const relativePath = this.getLocalPath(key);
      
      if (!this.shouldIgnoreFile(relativePath)) {
        const s3Object: S3Object = {
          Key: key,
          LastModified: mockObj.LastModified,
          Size: mockObj.Size,
        };
        remoteFiles.set(relativePath, s3Object);
      }
    }
    
    return remoteFiles;
  }

  async uploadFile(file: TFile, content: ArrayBuffer): Promise<number> {
    if (!this.configured) {
      throw new Error('S3 client not configured.');
    }

    const key = this.getRemoteKey(file.path);
    const lastModified = new Date();
    
    this.objects.set(key, {
      Key: key,
      LastModified: lastModified,
      Size: content.byteLength,
      content: content,
    });

    return lastModified.getTime();
  }

  async downloadFile(s3Object: S3Object): Promise<ArrayBuffer> {
    if (!this.configured) {
      throw new Error('S3 client not configured.');
    }

    const mockObj = this.objects.get(s3Object.Key!);
    if (!mockObj) {
      throw new Error(`File not found: ${s3Object.Key}`);
    }

    return mockObj.content;
  }

  async deleteRemoteFile(path: string): Promise<void> {
    if (!this.configured) {
      throw new Error('S3 client not configured.');
    }

    const key = this.getRemoteKey(path);
    this.objects.delete(key);
  }

  async getFileMetadata(filePath: string): Promise<number> {
    if (!this.configured) {
      throw new Error('S3 client not configured.');
    }

    const key = this.getRemoteKey(filePath);
    const mockObj = this.objects.get(key);
    if (!mockObj) {
      throw new Error(`File not found: ${filePath}`);
    }

    return mockObj.LastModified.getTime();
  }
}