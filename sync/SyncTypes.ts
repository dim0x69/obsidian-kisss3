// Types and interfaces for the three-source sync algorithm

export interface SyncState {
	[filePath: string]: string; // filePath -> mtime (ISO8601 or Unix timestamp)
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

// Timestamp comparison utilities
export const TIMESTAMP_TOLERANCE_MS = 2000; // 2 seconds tolerance for timestamp comparisons

/**
 * Compares two timestamps with tolerance to account for different file system precisions
 * @param time1 First timestamp in milliseconds
 * @param time2 Second timestamp in milliseconds
 * @returns -1 if time1 < time2, 1 if time1 > time2, 0 if equal within tolerance
 */
export function compareTimestamps(time1: number, time2: number): number {
	const diff = time1 - time2;
	if (Math.abs(diff) <= TIMESTAMP_TOLERANCE_MS) {
		return 0; // Equal within tolerance
	}
	return diff > 0 ? 1 : -1;
}

/**
 * Checks if time1 is newer than time2 with tolerance
 */
export function isNewerTimestamp(time1: number, time2: number): boolean {
	return compareTimestamps(time1, time2) > 0;
}

/**
 * Checks if two timestamps are equal within tolerance
 */
export function areTimestampsEqual(time1: number, time2: number): boolean {
	return compareTimestamps(time1, time2) === 0;
}