import {
	FileStatus,
	SyncAction,
	FileSyncDecision,
	LocalFile,
	RemoteFile,
	LocalFilesMap,
	RemoteFilesMap,
	StateFilesMap,
	SyncFileState,
} from "./SyncTypes";

import { KISSS3_DEBUG_LOG } from "../main";
/**
 * Engine for making sync decisions based on three-source comparison
 */
export class SyncDecisionEngine {
	/**
	 * Analyzes all files and generates sync decisions
	 * @param localFiles Map of local files
	 * @param remoteFiles Map of remote files
	 * @param stateFiles Map of state files
	 * @returns Array of sync decisions
	 */
	generateSyncDecisions(
		localFiles: LocalFilesMap,
		remoteFiles: RemoteFilesMap,
		stateFiles: StateFilesMap,
	): FileSyncDecision[] {
		const decisions: FileSyncDecision[] = [];

		// Get all unique file paths across all three sources
		const allFilePaths = new Set<string>([
			...localFiles.keys(),
			...remoteFiles.keys(),
			...stateFiles.keys(),
		]);
		if (KISSS3_DEBUG_LOG) {
			console.log(
				`generateSyncDecisions - localFile Keys: ${Array.from(localFiles.keys())}`,
			);
			console.log(
				`generateSyncDecisions - remoteFile Keys: ${Array.from(remoteFiles.keys())}`,
			);
			console.log(
				`generateSyncDecisions - stateFile Keys: ${Array.from(stateFiles.keys())}`,
			);
		}
		for (const filePath of allFilePaths) {
			if (KISSS3_DEBUG_LOG) {
				console.log(
					`generateSyncDecisions: Analyzing now: ${filePath}`,
				);
			}
			const decision = this.analyzeFile(
				filePath,
				localFiles,
				remoteFiles,
				stateFiles,
			);
			if (KISSS3_DEBUG_LOG) {
				console.log(
					`generateSyncDecisions: ${filePath}, descision: ${decision.action}`,
				);
			}

			decisions.push(decision);
		}

		return decisions;
	}

	/**
	 * Analyzes a single file and determines the sync action
	 */
	private analyzeFile(
		filePath: string,
		localFiles: LocalFilesMap,
		remoteFiles: RemoteFilesMap,
		stateFiles: StateFilesMap,
	): FileSyncDecision {
		const localFile = localFiles.get(filePath);
		const remoteFile = remoteFiles.get(filePath);
		const syncState = stateFiles.get(filePath);

		// Determine status for local and remote
		const localStatus = this.determineFileStatus(
			localFile,
			syncState,
			true,
		);
		const remoteStatus = this.determineFileStatus(
			remoteFile,
			syncState,
			false,
		);

		// Apply decision matrix
		const action = this.applyDecisionMatrix(
			localStatus,
			remoteStatus,
			localFile,
			remoteFile,
		);
		if (KISSS3_DEBUG_LOG) {
			console.log(
				`analyzeFile: ${filePath}, localStatus: ${localStatus}, remoteStatus: ${remoteStatus}, action: ${action}`,
			);
		}

		return {
			filePath,
			localStatus,
			remoteStatus,
			action,
			conflictType:
				action === SyncAction.CONFLICT
					? this.getConflictDescription(localStatus, remoteStatus)
					: undefined,
		};
	}

	/**
	 * Determines the status of a file compared to its state
	 */
	private determineFileStatus(
		file: LocalFile | RemoteFile | undefined,
		syncState: SyncFileState | undefined,
		isLocal: boolean,
	): FileStatus {
		const stateTime = isLocal
			? syncState?.localMtime
			: syncState?.remoteMtime;

		if (KISSS3_DEBUG_LOG) {
			console.log(
				`determineFileStatus: file: ${file?.path}, stateTime: ${stateTime}, isLocal: ${isLocal}`,
			);
		}
		// if !file, then the file did not exist in the respective
		// map
		if (!file && !stateTime) {
			return FileStatus.UNCHANGED; // File never existed (state) / does not exist now (local / remote)
		}

		if (!file && stateTime) {
			return FileStatus.DELETED; // File existed in state but doesn't exist now
		}

		if (file && !stateTime) {
			return FileStatus.CREATED; // File exists now but wasn't in state
		}

		if (file && stateTime) {
			// Compare exact timestamps - no tolerance needed since we control both values
			if (file.mtime > stateTime) {
				return FileStatus.MODIFIED; // File was modified since state
			}
			return FileStatus.UNCHANGED; // File hasn't changed since state
		}

		return FileStatus.UNCHANGED;
	}

	/**
	 * Applies the decision matrix to determine sync action
	 */
	private applyDecisionMatrix(
		localStatus: FileStatus,
		remoteStatus: FileStatus,
		localFile?: LocalFile,
		remoteFile?: RemoteFile,
	): SyncAction {
		// Decision Matrix Implementation based on specifications

		// Case: File only exists locally
		if (
			localStatus !== FileStatus.UNCHANGED &&
			remoteStatus === FileStatus.UNCHANGED
		) {
			if (localStatus === FileStatus.DELETED) {
				return SyncAction.DELETE_REMOTE; // Already deleted locally
			}
			return SyncAction.UPLOAD; // Created or Modified locally
		}

		// Case: File only exists remotely
		if (
			localStatus === FileStatus.UNCHANGED &&
			remoteStatus !== FileStatus.UNCHANGED
		) {
			if (remoteStatus === FileStatus.DELETED) {
				return SyncAction.DELETE_LOCAL; // Already deleted remotely
			}
			return SyncAction.DOWNLOAD; // Created or Modified remotely
		}

		// Case: File exists in both locations
		if (
			localStatus !== FileStatus.UNCHANGED &&
			remoteStatus !== FileStatus.UNCHANGED
		) {
			return this.resolveConflict(
				localStatus,
				remoteStatus,
				localFile,
				remoteFile,
			);
		}

		// Case: File deleted locally but exists/modified remotely
		if (
			localStatus === FileStatus.DELETED &&
			remoteStatus !== FileStatus.UNCHANGED
		) {
			if (remoteStatus === FileStatus.DELETED) {
				return SyncAction.DO_NOTHING; // Both deleted
			}
			// Modification vs Deletion: Modification wins
			return SyncAction.DOWNLOAD;
		}

		// Case: File deleted remotely but exists/modified locally
		if (
			remoteStatus === FileStatus.DELETED &&
			localStatus !== FileStatus.UNCHANGED
		) {
			if (localStatus === FileStatus.DELETED) {
				return SyncAction.DO_NOTHING; // Both deleted
			}
			// Modification vs Deletion: Modification wins
			return SyncAction.UPLOAD;
		}

		return SyncAction.DO_NOTHING; // No changes needed
	}

	/**
	 * Resolves conflicts between local and remote changes
	 */
	private resolveConflict(
		localStatus: FileStatus,
		remoteStatus: FileStatus,
		localFile?: LocalFile,
		remoteFile?: RemoteFile,
	): SyncAction {
		// Modification vs. Deletion: Modification wins
		if (
			localStatus === FileStatus.DELETED &&
			remoteStatus === FileStatus.MODIFIED
		) {
			return SyncAction.DOWNLOAD;
		}
		if (
			localStatus === FileStatus.MODIFIED &&
			remoteStatus === FileStatus.DELETED
		) {
			return SyncAction.UPLOAD;
		}

		// Creation vs. Deletion: Creation wins
		if (
			localStatus === FileStatus.DELETED &&
			remoteStatus === FileStatus.CREATED
		) {
			return SyncAction.DOWNLOAD;
		}
		if (
			localStatus === FileStatus.CREATED &&
			remoteStatus === FileStatus.DELETED
		) {
			return SyncAction.UPLOAD;
		}

		// All other conflicts: Newest wins by mtime
		if (localFile && remoteFile) {
			if (localFile.mtime > remoteFile.mtime) {
				return SyncAction.UPLOAD;
			} else if (remoteFile.mtime > localFile.mtime) {
				return SyncAction.DOWNLOAD;
			}
			// If timestamps are exactly equal, no action needed
		}

		// If we can't determine, flag as conflict for manual resolution
		return SyncAction.CONFLICT;
	}

	/**
	 * Gets a description of the conflict type for logging
	 */
	private getConflictDescription(
		localStatus: FileStatus,
		remoteStatus: FileStatus,
	): string {
		return `Local: ${localStatus}, Remote: ${remoteStatus}`;
	}
}
