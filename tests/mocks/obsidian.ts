// Mock Obsidian API for Jest tests

export interface FileStats {
  ctime: number;
  mtime: number;
  size: number;
}

export interface TFile {
  basename: string;
  extension: string;
  name: string;
  parent: TFolder | null;
  path: string;
  stat: FileStats;
  vault: any;
}

export interface TFolder {
  children: (TFile | TFolder)[];
  name: string;
  parent: TFolder | null;
  path: string;
  vault: any;
  isRoot(): boolean;
}

export interface App {
  vault: Vault;
}

export interface Vault {
  getFiles(): TFile[];
  getAllLoadedFiles(): (TFile | TFolder)[];
  getAbstractFileByPath(path: string): TFile | TFolder | null;
  readBinary(file: TFile): Promise<ArrayBuffer>;
  modifyBinary(file: TFile, data: ArrayBuffer, options?: { mtime?: number }): Promise<void>;
  createBinary(path: string, data: ArrayBuffer, options?: { mtime?: number }): Promise<TFile>;
  delete(file: TFile | TFolder): Promise<void>;
  createFolder(path: string): Promise<TFolder>;
}

export class Notice {
  constructor(message: string, timeout?: number) {
    // Mock implementation
  }

  setMessage(message: string): void {
    // Mock implementation
  }

  hide(): void {
    // Mock implementation
  }
}

// Export everything that might be imported from 'obsidian'
export * from './MockObsidianApp';