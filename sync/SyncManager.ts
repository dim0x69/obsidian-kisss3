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
	SyncState
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
		this.s3Service = new S3Service(this.plugin.settings);
		this.stateManager = new SyncStateManager(this.app);
		this.decisionEngine = new SyncDecisionEngine();
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
				this.getStateFilesMap()
			]);

			// Step 2: Generate sync decisions
			syncNotice.setMessage("S3 Sync: Analyzing files...");
			const decisions = this.decisionEngine.generateSyncDecisions(
				localFiles, 
				remoteFiles, 
				stateFiles
			);

			// Step 3: Execute sync actions in safe order (downloads → uploads → deletes)
			await this.executeSyncDecisions(decisions, syncNotice);

			// Step 4: Rescan and save new state (only after successful sync)
			syncNotice.setMessage("S3 Sync: Updating state...");
			await this.updateSyncState();

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
					mtime: file.stat.mtime
				});
			}
		});
		
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
			if (!this.shouldIgnoreFile(path) && s3Object.LastModified && s3Object.Key) {
				remoteFiles.set(path, {
					path: path,
					mtime: s3Object.LastModified.getTime(),
					key: s3Object.Key
				});
			}
		}

		return remoteFiles;
	}

	/**
	 * Generates state files map from the state file
	 */
	private async generateStateFilesMap(): Promise<StateFilesMap> {
		const stateFiles = new Map<string, string>();
		const syncState = await this.stateManager.loadState();

		for (const [filePath, mtime] of Object.entries(syncState)) {
			// Apply exclusion rule: ignore files/folders starting with a dot
			if (!this.shouldIgnoreFile(filePath)) {
				stateFiles.set(filePath, mtime);
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
		syncNotice: Notice
	): Promise<void> {
		const downloads = decisions.filter(d => d.action === SyncAction.DOWNLOAD);
		const uploads = decisions.filter(d => d.action === SyncAction.UPLOAD);
		const deletes = decisions.filter(d => 
			d.action === SyncAction.DELETE_LOCAL || d.action === SyncAction.DELETE_REMOTE
		);
		const conflicts = decisions.filter(d => d.action === SyncAction.CONFLICT);

		// Execute downloads first
		for (const decision of downloads) {
			syncNotice.setMessage(`S3 Sync: Downloading ${decision.filePath}`);
			await this.executeDownload(decision);
		}

		// Execute uploads second
		for (const decision of uploads) {
			syncNotice.setMessage(`S3 Sync: Uploading ${decision.filePath}`);
			await this.executeUpload(decision);
		}

		// Execute deletes last
		for (const decision of deletes) {
			syncNotice.setMessage(`S3 Sync: Deleting ${decision.filePath}`);
			await this.executeDelete(decision);
		}

		// Handle conflicts
		for (const decision of conflicts) {
			syncNotice.setMessage(`S3 Sync: Resolving conflict for ${decision.filePath}`);
			await this.handleConflict(decision);
		}
	}

	/**
	 * Executes a download action
	 */
	private async executeDownload(decision: FileSyncDecision): Promise<void> {
		// Get the remote file info from cache
		const remoteFiles = await this.getRemoteFilesMap();
		const remoteFile = remoteFiles.get(decision.filePath);
		
		if (!remoteFile) {
			throw new Error(`Remote file not found: ${decision.filePath}`);
		}

		// Create an S3Object for compatibility with existing S3Service
		const s3Object: S3Object = {
			Key: remoteFile.key,
			LastModified: new Date(remoteFile.mtime)
		};

		const content = await this.s3Service.downloadFile(s3Object);
		
		// Ensure parent folder exists
		await this.ensureFolderExists(decision.filePath);
		
		// Check if local file exists
		const localFile = this.app.vault.getAbstractFileByPath(decision.filePath);
		
		if (localFile && !(localFile instanceof TFolder)) {
			// File exists, modify it
			await this.app.vault.modifyBinary(localFile as TFile, content, {
				mtime: remoteFile.mtime
			});
		} else {
			// File doesn't exist, create it
			await this.app.vault.createBinary(decision.filePath, content, {
				mtime: remoteFile.mtime
			});
		}
	}

	/**
	 * Executes an upload action
	 */
	private async executeUpload(decision: FileSyncDecision): Promise<void> {
		const localFile = this.app.vault.getAbstractFileByPath(decision.filePath);
		
		if (!localFile || localFile instanceof TFolder) {
			throw new Error(`Local file not found: ${decision.filePath}`);
		}

		const content = await this.app.vault.readBinary(localFile as TFile);
		await this.s3Service.uploadFile(localFile as TFile, content);
	}

	/**
	 * Executes a delete action  
	 */
	private async executeDelete(decision: FileSyncDecision): Promise<void> {
		if (decision.action === SyncAction.DELETE_LOCAL) {
			const localFile = this.app.vault.getAbstractFileByPath(decision.filePath);
			if (localFile && !(localFile instanceof TFolder)) {
				await this.app.vault.delete(localFile);
			}
		} else if (decision.action === SyncAction.DELETE_REMOTE) {
			await this.s3Service.deleteRemoteFile(decision.filePath);
		}
	}

	/**
	 * Handles conflict resolution
	 */
	private async handleConflict(decision: FileSyncDecision): Promise<void> {
		// For now, use the same strategy as before: keep local version, save remote as conflict file
		const localFile = this.app.vault.getAbstractFileByPath(decision.filePath) as TFile;
		const remoteFiles = await this.getRemoteFilesMap();
		const remoteFile = remoteFiles.get(decision.filePath);
		
		if (!localFile || !remoteFile) {
			console.warn(`S3 Sync: Cannot resolve conflict for ${decision.filePath} - missing file`);
			return;
		}

		// Create S3Object for compatibility
		const s3Object: S3Object = {
			Key: remoteFile.key,
			LastModified: new Date(remoteFile.mtime)
		};

		const remoteContent = await this.s3Service.downloadFile(s3Object);
		const conflictFileName = this.getConflictFileName(
			decision.filePath,
			new Date(remoteFile.mtime)
		);

		// Save the remote version with a new name
		await this.app.vault.createBinary(conflictFileName, remoteContent, {
			mtime: remoteFile.mtime
		});

		new Notice(
			`S3 Sync: Saved remote version as ${conflictFileName}`,
		);

		// Upload the local version to overwrite the remote
		const localContent = await this.app.vault.readBinary(localFile);
		await this.s3Service.uploadFile(localFile, localContent);
	}

	/**
	 * Ensures the parent folder exists for a file path
	 */
	private async ensureFolderExists(filePath: string): Promise<void> {
		const folderPath = filePath.substring(0, filePath.lastIndexOf("/"));
		if (folderPath) {
			try {
				const existingFolder = this.app.vault.getAbstractFileByPath(folderPath);
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
		const extension = lastDotIndex > -1 ? originalPath.substring(lastDotIndex) : "";
		const baseName = lastDotIndex > -1 ? originalPath.substring(0, lastDotIndex) : originalPath;
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
	 * Updates the sync state after successful sync
	 */
	private async updateSyncState(): Promise<void> {
		// Get current state from cache (or generate fresh if cache is cleared)
		const [localFiles, remoteFiles] = await Promise.all([
			this.getLocalFilesMap(),
			this.getRemoteFilesMap()
		]);

		// Build new state map
		const newState: SyncState = {};

		// Add local files to state
		for (const [path, localFile] of localFiles.entries()) {
			newState[path] = localFile.mtime.toString();
		}

		// Add remote files to state (use remote mtime if file exists on both sides)
		for (const [path, remoteFile] of remoteFiles.entries()) {
			const localFile = localFiles.get(path);
			if (localFile) {
				// File exists locally and remotely, use the newer timestamp
				const newerMtime = Math.max(localFile.mtime, remoteFile.mtime);
				newState[path] = newerMtime.toString();
			} else {
				// File only exists remotely
				newState[path] = remoteFile.mtime.toString();
			}
		}

		// Save the new state
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
			const folders = allFiles.filter(f => f instanceof TFolder) as TFolder[];
			
			// Sort by depth (deepest first) to prune from bottom up
			folders.sort((a, b) => b.path.split("/").length - a.path.split("/").length);

			for (const folder of folders) {
				if (folder.children && folder.children.length === 0) {
					// Don't delete the plugin's own folder or system folders
					if (!folder.path.startsWith(".obsidian") || folder.path === ".obsidian/plugins/kisss3") {
						continue;
					}
					
					try {
						await this.app.vault.delete(folder);
						console.log(`S3 Sync: Pruned empty folder: ${folder.path}`);
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
			console.error(`S3 Sync: Error deleting remote file ${path}:`, error);
		}
	}
}
