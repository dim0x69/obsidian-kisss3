import { 
	FileStatus, 
	SyncAction, 
	FileSyncDecision, 
	LocalFile, 
	RemoteFile, 
	LocalFilesMap, 
	RemoteFilesMap, 
	StateFilesMap 
} from "./SyncTypes";

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
		stateFiles: StateFilesMap
	): FileSyncDecision[] {
		const decisions: FileSyncDecision[] = [];
		
		// Get all unique file paths across all three sources
		const allFilePaths = new Set<string>([
			...localFiles.keys(),
			...remoteFiles.keys(),
			...stateFiles.keys()
		]);

		for (const filePath of allFilePaths) {
			const decision = this.analyzeFile(filePath, localFiles, remoteFiles, stateFiles);
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
		stateFiles: StateFilesMap
	): FileSyncDecision {
		const localFile = localFiles.get(filePath);
		const remoteFile = remoteFiles.get(filePath);
		const stateTimestamp = stateFiles.get(filePath);

		// Determine status for local and remote
		const localStatus = this.determineFileStatus(localFile, stateTimestamp);
		const remoteStatus = this.determineFileStatus(remoteFile, stateTimestamp);

		// Apply decision matrix
		const action = this.applyDecisionMatrix(localStatus, remoteStatus, localFile, remoteFile);

		return {
			filePath,
			localStatus,
			remoteStatus,
			action,
			conflictType: action === SyncAction.CONFLICT ? 
				this.getConflictDescription(localStatus, remoteStatus) : undefined
		};
	}

	/**
	 * Determines the status of a file compared to its state
	 */
	private determineFileStatus(
		file: LocalFile | RemoteFile | undefined, 
		stateTimestamp: string | undefined
	): FileStatus {
		if (!file && !stateTimestamp) {
			return FileStatus.UNCHANGED; // File never existed
		}
		
		if (!file && stateTimestamp) {
			return FileStatus.DELETED; // File existed in state but doesn't exist now
		}
		
		if (file && !stateTimestamp) {
			return FileStatus.CREATED; // File exists now but wasn't in state
		}
		
		if (file && stateTimestamp) {
			const stateTime = parseInt(stateTimestamp);
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
		remoteFile?: RemoteFile
	): SyncAction {
		// Decision Matrix Implementation based on specifications

		// Case: File only exists locally
		if (localStatus !== FileStatus.UNCHANGED && remoteStatus === FileStatus.UNCHANGED) {
			if (localStatus === FileStatus.DELETED) {
				return SyncAction.DO_NOTHING; // Already deleted locally
			}
			return SyncAction.UPLOAD; // Created or Modified locally
		}

		// Case: File only exists remotely  
		if (localStatus === FileStatus.UNCHANGED && remoteStatus !== FileStatus.UNCHANGED) {
			if (remoteStatus === FileStatus.DELETED) {
				return SyncAction.DO_NOTHING; // Already deleted remotely
			}
			return SyncAction.DOWNLOAD; // Created or Modified remotely
		}

		// Case: File exists in both locations
		if (localStatus !== FileStatus.UNCHANGED && remoteStatus !== FileStatus.UNCHANGED) {
			return this.resolveConflict(localStatus, remoteStatus, localFile, remoteFile);
		}

		// Case: File deleted locally but exists/modified remotely
		if (localStatus === FileStatus.DELETED && remoteStatus !== FileStatus.UNCHANGED) {
			if (remoteStatus === FileStatus.DELETED) {
				return SyncAction.DO_NOTHING; // Both deleted
			}
			// Modification vs Deletion: Modification wins
			return SyncAction.DOWNLOAD;
		}

		// Case: File deleted remotely but exists/modified locally  
		if (remoteStatus === FileStatus.DELETED && localStatus !== FileStatus.UNCHANGED) {
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
		remoteFile?: RemoteFile
	): SyncAction {
		// Modification vs. Deletion: Modification wins
		if (localStatus === FileStatus.DELETED && remoteStatus === FileStatus.MODIFIED) {
			return SyncAction.DOWNLOAD;
		}
		if (localStatus === FileStatus.MODIFIED && remoteStatus === FileStatus.DELETED) {
			return SyncAction.UPLOAD;
		}

		// Creation vs. Deletion: Creation wins  
		if (localStatus === FileStatus.DELETED && remoteStatus === FileStatus.CREATED) {
			return SyncAction.DOWNLOAD;
		}
		if (localStatus === FileStatus.CREATED && remoteStatus === FileStatus.DELETED) {
			return SyncAction.UPLOAD;
		}

		// All other conflicts: Newest wins by mtime
		if (localFile && remoteFile) {
			if (localFile.mtime > remoteFile.mtime) {
				return SyncAction.UPLOAD;
			} else if (remoteFile.mtime > localFile.mtime) {
				return SyncAction.DOWNLOAD;
			}
		}

		// If we can't determine, flag as conflict for manual resolution
		return SyncAction.CONFLICT;
	}

	/**
	 * Gets a description of the conflict type for logging
	 */
	private getConflictDescription(localStatus: FileStatus, remoteStatus: FileStatus): string {
		return `Local: ${localStatus}, Remote: ${remoteStatus}`;
	}
}