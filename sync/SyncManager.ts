import { App, Notice, TFile, TFolder } from "obsidian";
import { S3Service } from "../s3/S3Service";
import S3SyncPlugin from "../main";

import { S3SyncSettings } from "../settings";
import { _Object as S3Object } from "@aws-sdk/client-s3";
import { SyncStateManager } from "./SyncStateManager";
import { SyncDecisionEngine } from "./SyncDecisionEngine";
import {
	SyncAction,
	FileSyncDecision,
	LocalFilesMap,
	RemoteFilesMap,
	StateFilesMap,
	LocalFile,
	RemoteFile,
	SyncState,
	SyncFileState,
} from "./SyncTypes";

// Contains the core logic for comparing and synchronizing files.
// https://docs.obsidian.md/Reference/TypeScript+API/FileStats

export class SyncManager {
	private s3Service: S3Service;
	private stateManager: SyncStateManager;
	private decisionEngine: SyncDecisionEngine;
	private running = false;

	// Cache for file maps during sync operation
	private cachedLocalFiles: LocalFilesMap | null = null;
	private cachedRemoteFiles: RemoteFilesMap | null = null;
	private cachedStateFiles: StateFilesMap | null = null;

	constructor(
		private app: App,
		private plugin: S3SyncPlugin,
	) {
		this.s3Service = new S3Service(this.plugin.settings, this.plugin);
		this.stateManager = new SyncStateManager(this.app, this.plugin);
		this.decisionEngine = new SyncDecisionEngine(this.plugin);
	}

	updateSettings(settings: S3SyncSettings) {
		this.s3Service.updateSettings(settings);
	}

	async runSync(): Promise<void> {
		if (this.running) {
			new Notice("S3 Sync: A sync is already in progress.");
			return;
		}
		if (!this.s3Service.isConfigured()) {
			new Notice(
				"S3 Sync: Plugin not configured. Please check settings.",
			);
			return;
		}
		this.running = true;
		const syncNotice = new Notice("S3 Sync: Starting sync...", 0);

		try {
			// Step 1: Generate and cache the three maps (Local, Remote, State)
			syncNotice.setMessage("S3 Sync: Generating file maps...");
			const [localFiles, remoteFiles, stateFiles] = await Promise.all([
				this.getLocalFilesMap(),
				this.getRemoteFilesMap(),
				this.getStateFilesMap(),
			]);

			// Step 2: Generate sync decisions
			syncNotice.setMessage("S3 Sync: Analyzing files...");
			const decisions = this.decisionEngine.generateSyncDecisions(
				localFiles,
				remoteFiles,
				stateFiles,
			);

			// Step 3: Execute sync actions in safe order, updating state map on-the-fly
			await this.executeSyncDecisions(decisions, syncNotice, stateFiles);

			// Step 4: Save updated state map (no rescanning needed)
			syncNotice.setMessage("S3 Sync: Updating state...");
			await this.saveUpdatedSyncState(stateFiles);

			syncNotice.setMessage("S3 Sync: Sync complete!");
		} catch (error) {
			console.error("S3 Sync Error:", error);
			syncNotice.setMessage(
				`S3 Sync: Error during sync. Check console for details.`,
			);
			// Don't update state on error
		} finally {
			// Clear cached maps
			this.clearCachedMaps();
			this.running = false;
			setTimeout(() => syncNotice.hide(), 5000);
		}
	}

	/**
	 * Gets local files map with caching during sync operation
	 */
	private async getLocalFilesMap(): Promise<LocalFilesMap> {
		if (this.cachedLocalFiles) {
			return this.cachedLocalFiles;
		}

		this.cachedLocalFiles = await this.generateLocalFilesMap();
		return this.cachedLocalFiles;
	}

	/**
	 * Gets remote files map with caching during sync operation
	 */
	private async getRemoteFilesMap(): Promise<RemoteFilesMap> {
		if (this.cachedRemoteFiles) {
			return this.cachedRemoteFiles;
		}

		this.cachedRemoteFiles = await this.generateRemoteFilesMap();
		return this.cachedRemoteFiles;
	}

	/**
	 * Gets state files map with caching during sync operation
	 */
	private async getStateFilesMap(): Promise<StateFilesMap> {
		if (this.cachedStateFiles) {
			return this.cachedStateFiles;
		}

		this.cachedStateFiles = await this.generateStateFilesMap();
		return this.cachedStateFiles;
	}

	/**
	 * Clears cached file maps after sync operation
	 */
	private clearCachedMaps(): void {
		this.cachedLocalFiles = null;
		this.cachedRemoteFiles = null;
		this.cachedStateFiles = null;
	}

	/**
	 * Generates local files map with exclusion rules applied
	 */
	private async generateLocalFilesMap(): Promise<LocalFilesMap> {
		const localFiles = new Map<string, LocalFile>();

		this.app.vault.getFiles().forEach((file) => {
			// Apply exclusion rule: ignore files/folders starting with a dot
			if (!this.shouldIgnoreFile(file.path)) {
				localFiles.set(file.path, {
					path: file.path,
					mtime: file.stat.mtime,
				});
			}
		});

		if (this.plugin.settings.enableDebugLogging) {
			console.log(
				"generateLocalFilesMap - Local Files Map Keys:",
				Array.from(localFiles.keys()),
			);
		}
		return localFiles;
	}

	/**
	 * Generates remote files map with exclusion rules applied
	 */
	private async generateRemoteFilesMap(): Promise<RemoteFilesMap> {
		const remoteFiles = new Map<string, RemoteFile>();
		const s3Objects = await this.s3Service.listRemoteFiles();

		for (const [path, s3Object] of s3Objects.entries()) {
			// Apply exclusion rule: ignore files/folders starting with a dot
			if (
				!this.shouldIgnoreFile(path) &&
				s3Object.LastModified &&
				s3Object.Key
			) {
				remoteFiles.set(path, {
					path: path,
					mtime: s3Object.LastModified.getTime(),
					key: s3Object.Key,
				});
			}
		}
		if (this.plugin.settings.enableDebugLogging) {
			console.log(
				`generateRemoteFilesMap : Remote Files Map Keys ${Array.from(remoteFiles.keys())}`,
			);
		}
		return remoteFiles;
	}

	/**
	 * Generates state files map from the state file
	 */
	private async generateStateFilesMap(): Promise<StateFilesMap> {
		const stateFiles = new Map<string, SyncFileState>();
		const syncState = await this.stateManager.loadState();

		for (const [filePath, fileState] of Object.entries(syncState)) {
			// Apply exclusion rule: ignore files/folders starting with a dot
			if (!this.shouldIgnoreFile(filePath)) {
				// Handle both old format (string) and new format (SyncFileState)
				if (typeof fileState === "string") {
					// Legacy format - treat as local mtime
					stateFiles.set(filePath, {
						localMtime: parseInt(fileState),
					});
				} else {
					// New format
					stateFiles.set(filePath, fileState);
				}
			}
		}

		return stateFiles;
	}

	/**
	 * Checks if a file should be ignored based on exclusion rules
	 */
	private shouldIgnoreFile(filePath: string): boolean {
		// Ignore files/folders beginning with a dot
		return filePath.split("/").some((part) => part.startsWith("."));
	}

	/**
	 * Executes sync decisions in safe order: downloads → uploads → deletes
	 */
	private async executeSyncDecisions(
		decisions: FileSyncDecision[],
		syncNotice: Notice,
		stateFiles: StateFilesMap,
	): Promise<void> {
		const downloads = decisions.filter(
			(d) => d.action === SyncAction.DOWNLOAD,
		);
		const uploads = decisions.filter((d) => d.action === SyncAction.UPLOAD);
		const deletes = decisions.filter(
			(d) =>
				d.action === SyncAction.DELETE_LOCAL ||
				d.action === SyncAction.DELETE_REMOTE,
		);
		const conflicts = decisions.filter(
			(d) => d.action === SyncAction.CONFLICT,
		);

		// Execute downloads first
		for (const decision of downloads) {
			syncNotice.setMessage(`S3 Sync: Downloading ${decision.filePath}`);
			await this.executeDownload(decision, stateFiles);
		}

		// Execute uploads second
		for (const decision of uploads) {
			syncNotice.setMessage(`S3 Sync: Uploading ${decision.filePath}`);
			await this.executeUpload(decision, stateFiles);
		}

		// Execute deletes last
		for (const decision of deletes) {
			syncNotice.setMessage(`S3 Sync: Deleting ${decision.filePath}`);
			await this.executeDelete(decision, stateFiles);
		}

		// Handle conflicts
		for (const decision of conflicts) {
			syncNotice.setMessage(
				`S3 Sync: Resolving conflict for ${decision.filePath}`,
			);
			await this.handleConflict(decision, stateFiles);
		}
	}

	/**
	 * Executes a download action and updates state map immediately
	 */
	private async executeDownload(decision: FileSyncDecision, stateFiles: StateFilesMap): Promise<void> {
		// Get the remote file info from cache
		const remoteFiles = await this.getRemoteFilesMap();
		const remoteFile = remoteFiles.get(decision.filePath);

		if (!remoteFile) {
			throw new Error(`Remote file not found: ${decision.filePath}`);
		}

		// Create an S3Object for compatibility with existing S3Service
		const s3Object: S3Object = {
			Key: remoteFile.key,
			LastModified: new Date(remoteFile.mtime),
		};

		const content = await this.s3Service.downloadFile(s3Object);

		// Ensure parent folder exists
		await this.ensureFolderExists(decision.filePath);

		// Check if local file exists
		const localFile = this.app.vault.getAbstractFileByPath(
			decision.filePath,
		);

		if (localFile && !(localFile instanceof TFolder)) {
			// File exists, modify it
			await this.app.vault.modifyBinary(localFile as TFile, content, {
				mtime: remoteFile.mtime,
			});
		} else {
			// File doesn't exist, create it
			await this.app.vault.createBinary(decision.filePath, content, {
				mtime: remoteFile.mtime,
			});
		}

		// Update state map immediately after successful download
		// Get the actual local file mtime after download
		const downloadedLocalFile = this.app.vault.getAbstractFileByPath(decision.filePath) as TFile;
		if (!downloadedLocalFile) {
			throw new Error(`Downloaded file not found after creation: ${decision.filePath}`);
		}
		
		stateFiles.set(decision.filePath, {
			localMtime: downloadedLocalFile.stat.mtime,  // Use actual local file mtime
			remoteMtime: remoteFile.mtime,
		});
	}

	/**
	 * Executes an upload action and updates state map immediately
	 */
	private async executeUpload(decision: FileSyncDecision, stateFiles: StateFilesMap): Promise<void> {
		const localFile = this.app.vault.getAbstractFileByPath(
			decision.filePath,
		);

		if (!localFile || localFile instanceof TFolder) {
			throw new Error(`Local file not found: ${decision.filePath}`);
		}

		const content = await this.app.vault.readBinary(localFile as TFile);
		const actualRemoteMtime = await this.s3Service.uploadFile(localFile as TFile, content);

		// Update state map immediately after successful upload with actual S3 timestamps
		const localMtime = (localFile as TFile).stat.mtime;
		stateFiles.set(decision.filePath, {
			localMtime: localMtime,
			remoteMtime: actualRemoteMtime,  // Use actual S3 LastModified timestamp
		});
	}

	/**
	 * Executes a delete action and updates state map immediately
	 */
	private async executeDelete(decision: FileSyncDecision, stateFiles: StateFilesMap): Promise<void> {
		if (decision.action === SyncAction.DELETE_LOCAL) {
			const localFile = this.app.vault.getAbstractFileByPath(
				decision.filePath,
			);
			if (localFile && !(localFile instanceof TFolder)) {
				await this.app.vault.delete(localFile);
			}
			// Update state map: file deleted locally, clear localMtime
			const currentState = stateFiles.get(decision.filePath) || {};
			stateFiles.set(decision.filePath, {
				localMtime: undefined,
				remoteMtime: currentState.remoteMtime,
			});
		} else if (decision.action === SyncAction.DELETE_REMOTE) {
			await this.s3Service.deleteRemoteFile(decision.filePath);
			// Update state map: file deleted remotely, clear remoteMtime
			const currentState = stateFiles.get(decision.filePath) || {};
			stateFiles.set(decision.filePath, {
				localMtime: currentState.localMtime,
				remoteMtime: undefined,
			});
		}

		// If both local and remote are now undefined, remove the entry completely
		const updatedState = stateFiles.get(decision.filePath);
		if (updatedState && !updatedState.localMtime && !updatedState.remoteMtime) {
			stateFiles.delete(decision.filePath);
		}
	}

	/**
	 * Handles conflict resolution and updates state map immediately
	 */
	private async handleConflict(decision: FileSyncDecision, stateFiles: StateFilesMap): Promise<void> {
		// For now, use the same strategy as before: keep local version, save remote as conflict file
		const localFile = this.app.vault.getAbstractFileByPath(
			decision.filePath,
		) as TFile;
		const remoteFiles = await this.getRemoteFilesMap();
		const remoteFile = remoteFiles.get(decision.filePath);

		if (!localFile || !remoteFile) {
			console.warn(
				`S3 Sync: Cannot resolve conflict for ${decision.filePath} - missing file`,
			);
			return;
		}

		// Create S3Object for compatibility
		const s3Object: S3Object = {
			Key: remoteFile.key,
			LastModified: new Date(remoteFile.mtime),
		};

		const remoteContent = await this.s3Service.downloadFile(s3Object);
		const conflictFileName = this.getConflictFileName(
			decision.filePath,
			new Date(remoteFile.mtime),
		);

		// Save the remote version with a new name
		await this.app.vault.createBinary(conflictFileName, remoteContent, {
			mtime: remoteFile.mtime,
		});

		new Notice(`S3 Sync: Saved remote version as ${conflictFileName}`);

		// Upload the local version to overwrite the remote
		const localContent = await this.app.vault.readBinary(localFile);
		const actualRemoteMtime = await this.s3Service.uploadFile(localFile, localContent);

		// Update state map: local version wins, use actual S3 timestamp for remote
		const localMtime = localFile.stat.mtime;
		stateFiles.set(decision.filePath, {
			localMtime: localMtime,
			remoteMtime: actualRemoteMtime,  // Use actual S3 LastModified timestamp
		});
	}

	/**
	 * Ensures the parent folder exists for a file path
	 */
	private async ensureFolderExists(filePath: string): Promise<void> {
		const folderPath = filePath.substring(0, filePath.lastIndexOf("/"));
		if (folderPath) {
			try {
				const existingFolder =
					this.app.vault.getAbstractFileByPath(folderPath);
				if (!existingFolder) {
					await this.app.vault.createFolder(folderPath);
				}
			} catch (e) {
				// Folder likely created between check and call, ignore
			}
		}
	}

	private getConflictFileName(
		originalPath: string,
		conflictDate: Date,
	): string {
		const lastDotIndex = originalPath.lastIndexOf(".");
		const extension =
			lastDotIndex > -1 ? originalPath.substring(lastDotIndex) : "";
		const baseName =
			lastDotIndex > -1
				? originalPath.substring(0, lastDotIndex)
				: originalPath;
		const timestamp =
			conflictDate.getFullYear().toString() +
			(conflictDate.getMonth() + 1).toString().padStart(2, "0") +
			conflictDate.getDate().toString().padStart(2, "0") +
			"-" +
			conflictDate.getHours().toString().padStart(2, "0") +
			conflictDate.getMinutes().toString().padStart(2, "0") +
			conflictDate.getSeconds().toString().padStart(2, "0");

		return `${baseName} (conflict ${timestamp})${extension}`;
	}

	/**
	 * Saves the updated sync state from the cached state map (no rescanning needed)
	 */
	private async saveUpdatedSyncState(stateFiles: StateFilesMap): Promise<void> {
		// Convert Map back to SyncState object for saving, filtering out obsolete entries
		const newState: SyncState = {};
		
		for (const [filePath, fileState] of stateFiles.entries()) {
			// For robustness: Remove entries where only one timestamp is defined 
			// (incomplete state that can cause race conditions). This will result in 
			// a download/upload on the next sync, which is safer than keeping inconsistent state.
			const hasLocal = fileState.localMtime !== undefined;
			const hasRemote = fileState.remoteMtime !== undefined;
			
			// Only include entries that have both timestamps or neither (complete states)
			if ((hasLocal && hasRemote) || (!hasLocal && !hasRemote)) {
				// Skip entries with neither timestamp (obsolete)
				if (hasLocal || hasRemote) {
					newState[filePath] = fileState;
				}
			}
			// Incomplete entries (only localMtime or only remoteMtime) are filtered out
		}

		// Save the updated state
		await this.stateManager.saveState(newState);

		// Optional: Prune empty folders
		await this.pruneEmptyFolders();
	}

	/**
	 * Prunes empty folders after sync (optional feature)
	 */
	private async pruneEmptyFolders(): Promise<void> {
		try {
			const allFiles = this.app.vault.getAllLoadedFiles();
			const folders = allFiles.filter(
				(f) => f instanceof TFolder,
			) as TFolder[];

			// Sort by depth (deepest first) to prune from bottom up
			folders.sort(
				(a, b) => b.path.split("/").length - a.path.split("/").length,
			);

			for (const folder of folders) {
				if (folder.children && folder.children.length === 0) {
					// Don't delete the plugin's own folder or system folders
					if (
						!folder.path.startsWith(".obsidian") ||
						folder.path === ".obsidian/plugins/kisss3"
					) {
						continue;
					}

					try {
						await this.app.vault.delete(folder);
						console.log(
							`S3 Sync: Pruned empty folder: ${folder.path}`,
						);
					} catch (e) {
						// Ignore errors when pruning folders
					}
				}
			}
		} catch (error) {
			console.warn("S3 Sync: Error during folder pruning:", error);
		}
	}

	async handleLocalDelete(path: string): Promise<void> {
		if (!this.s3Service.isConfigured()) {
			return; // Silently skip if not configured
		}

		try {
			// Check if file exists remotely
			const remoteFiles = await this.s3Service.listRemoteFiles();
			if (remoteFiles.has(path)) {
				await this.s3Service.deleteRemoteFile(path);
				console.log(`S3 Sync: Deleted remote file ${path}`);
			}
		} catch (error) {
			console.error(
				`S3 Sync: Error deleting remote file ${path}:`,
				error,
			);
		}
	}
}
