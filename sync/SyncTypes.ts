// Types and interfaces for the three-source sync algorithm

export interface SyncState {
	[filePath: string]: SyncFileState;
}

export interface SyncFileState {
	localMtime?: number;  // Local file mtime when last synced
	remoteMtime?: number; // Remote file mtime when last synced
}

export interface FileInfo {
	path: string;
	mtime: number; // Unix timestamp in milliseconds
}

export type LocalFile = FileInfo;

export interface RemoteFile extends FileInfo {
	key: string; // S3 object key
	// Additional S3-specific properties if needed
}

export enum FileStatus {
	CREATED = "CREATED",
	MODIFIED = "MODIFIED", 
	DELETED = "DELETED",
	UNCHANGED = "UNCHANGED",
	NONEXIST = "NONEXIST"
}

export enum SyncAction {
	UPLOAD = "UPLOAD",
	DOWNLOAD = "DOWNLOAD", 
	DELETE_LOCAL = "DELETE_LOCAL",
	DELETE_REMOTE = "DELETE_REMOTE",
	CONFLICT = "CONFLICT",
	DO_NOTHING = "DO_NOTHING"
}

export interface FileSyncDecision {
	filePath: string;
	localStatus: FileStatus;
	remoteStatus: FileStatus;
	action: SyncAction;
	conflictType?: string; // Description of conflict type for logging
}

// Map types for the three sources
export type LocalFilesMap = Map<string, LocalFile>;
export type RemoteFilesMap = Map<string, RemoteFile>;
export type StateFilesMap = Map<string, SyncFileState>; // filePath -> sync state

