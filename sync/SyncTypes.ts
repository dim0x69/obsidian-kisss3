// Types and interfaces for the three-source sync algorithm

export interface SyncState {
	[filePath: string]: string; // filePath -> mtime (ISO8601 or Unix timestamp)
}

export interface FileInfo {
	path: string;
	mtime: number; // Unix timestamp in milliseconds
}

export interface LocalFile extends FileInfo {
	// Additional properties specific to local files if needed
}

export interface RemoteFile extends FileInfo {
	key: string; // S3 object key
	// Additional S3-specific properties if needed
}

export enum FileStatus {
	CREATED = "CREATED",
	MODIFIED = "MODIFIED", 
	DELETED = "DELETED",
	UNCHANGED = "UNCHANGED"
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
export type StateFilesMap = Map<string, string>; // filePath -> mtime string