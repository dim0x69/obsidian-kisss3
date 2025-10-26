import { TFile, TFolder, FileStats } from 'obsidian';

// Mock interfaces for Obsidian API
export interface MockFileStats extends FileStats {
  ctime: number;
  mtime: number;
  size: number;
}

export class MockTFile implements TFile {
  public basename: string;
  public extension: string;
  public name: string;
  public parent: TFolder | null = null;
  public path: string;
  public stat: MockFileStats;
  public vault: any = null;

  constructor(path: string, mtime: number = Date.now(), content: ArrayBuffer = new ArrayBuffer(0)) {
    this.path = path;
    this.name = path.split('/').pop() || '';
    this.basename = this.name.split('.')[0];
    this.extension = this.name.includes('.') ? this.name.split('.').pop() || '' : '';
    this.stat = {
      ctime: mtime - 1000,
      mtime: mtime,
      size: content.byteLength,
    };
  }
}

export class MockTFolder implements TFolder {
  public children: (TFile | TFolder)[] = [];
  public name: string;
  public parent: TFolder | null = null;
  public path: string;
  public vault: any = null;

  constructor(path: string) {
    this.path = path;
    this.name = path.split('/').pop() || '';
  }

  public isRoot(): boolean {
    return this.path === '';
  }
}

export class MockVault {
  private files: Map<string, MockTFile> = new Map();
  private folders: Map<string, MockTFolder> = new Map();
  private fileContents: Map<string, ArrayBuffer> = new Map();

  // Add file to the mock vault
  addFile(path: string, mtime: number = Date.now(), content: ArrayBuffer = new ArrayBuffer(0)): MockTFile {
    const file = new MockTFile(path, mtime, content);
    this.files.set(path, file);
    this.fileContents.set(path, content);
    return file;
  }

  // Remove file from the mock vault
  removeFile(path: string): void {
    this.files.delete(path);
    this.fileContents.delete(path);
  }

  // Mock Obsidian vault methods
  getFiles(): TFile[] {
    return Array.from(this.files.values());
  }

  getAllLoadedFiles(): (TFile | TFolder)[] {
    return [...Array.from(this.files.values()), ...Array.from(this.folders.values())];
  }

  getAbstractFileByPath(path: string): TFile | TFolder | null {
    return this.files.get(path) || this.folders.get(path) || null;
  }

  async readBinary(file: TFile): Promise<ArrayBuffer> {
    const content = this.fileContents.get(file.path);
    if (!content) {
      throw new Error(`File not found: ${file.path}`);
    }
    return content;
  }

  async modifyBinary(file: TFile, data: ArrayBuffer, options?: { mtime?: number }): Promise<void> {
    const mockFile = this.files.get(file.path);
    if (!mockFile) {
      throw new Error(`File not found: ${file.path}`);
    }
    this.fileContents.set(file.path, data);
    if (options?.mtime) {
      mockFile.stat.mtime = options.mtime;
    }
  }

  async createBinary(path: string, data: ArrayBuffer, options?: { mtime?: number }): Promise<TFile> {
    const mtime = options?.mtime || Date.now();
    const file = this.addFile(path, mtime, data);
    return file;
  }

  async delete(file: TFile | TFolder): Promise<void> {
    if (file instanceof MockTFile) {
      this.removeFile(file.path);
    } else if (file instanceof MockTFolder) {
      this.folders.delete(file.path);
    }
  }

  async createFolder(path: string): Promise<TFolder> {
    const folder = new MockTFolder(path);
    this.folders.set(path, folder);
    return folder;
  }
}

export class MockApp {
  public vault: MockVault;

  constructor() {
    this.vault = new MockVault();
  }
}