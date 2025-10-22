import { App, Notice, TFile } from "obsidian";
import { S3Service } from "../s3/S3Service";
import S3SyncPlugin from "../main";
import { S3SyncSettings } from "../settings";
import { _Object as S3Object } from "@aws-sdk/client-s3";

// Contains the core logic for comparing and synchronizing files.
// https://docs.obsidian.md/Reference/TypeScript+API/FileStats

export class SyncManager {
	private s3Service: S3Service;
	private running = false;

	constructor(
		private app: App,
		private plugin: S3SyncPlugin,
	) {
		this.s3Service = new S3Service(this.plugin.settings);
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
		const syncNotice = new Notice("S3 Sync: Starting sync...", 0); // Notice stays until hidden

		try {
			const lastSyncTimestamp = this.plugin.settings.lastSyncTimestamp;
			const newSyncTimestamp = Date.now();

			// Step 1: Get local and remote file lists
			syncNotice.setMessage(
				"S3 Sync: Fetching local and remote file lists...",
			);
			const localFiles = this.getLocalFiles();
			const remoteFiles = await this.s3Service.listRemoteFiles();

			const processedRemotePaths = new Set<string>();

			// Step 2: Process local files (check for uploads and conflicts)
			syncNotice.setMessage(
				"S3 Sync: Comparing local files to remote...",
			);
			for (const localFile of localFiles.values()) {
				const remoteFile = remoteFiles.get(localFile.path);
				processedRemotePaths.add(localFile.path);

				if (!remoteFile) {
					// File exists locally, but not remotely -> Upload
					syncNotice.setMessage(
						`S3 Sync: Uploading ${localFile.path}`,
					);
					const content = this.isBinaryFile(localFile.path) 
						? await this.app.vault.readBinary(localFile)
						: await this.app.vault.read(localFile);
					await this.s3Service.uploadFile(localFile, content);
				} else {
					const localMtime = localFile.stat.mtime;
					const remoteMtime = remoteFile.LastModified!.getTime();

					const localChanged = localMtime > lastSyncTimestamp;
					const remoteChanged = remoteMtime > lastSyncTimestamp;

					if (localChanged && remoteChanged) {
						// Conflict: Both files have changed since the last sync
						syncNotice.setMessage(
							`S3 Sync: Conflict detected for ${localFile.path}.`,
						);
						await this.handleConflict(localFile, remoteFile);
					} else if (localMtime > remoteMtime) {
						// Local is newer -> Upload
						syncNotice.setMessage(
							`S3 Sync: Uploading update for ${localFile.path}`,
						);
						const content = this.isBinaryFile(localFile.path) 
							? await this.app.vault.readBinary(localFile)
							: await this.app.vault.read(localFile);
						await this.s3Service.uploadFile(localFile, content);
					} else if (remoteMtime > localMtime) {
						// Remote is newer -> Download
						syncNotice.setMessage(
							`S3 Sync: Downloading update for ${localFile.path}`,
						);
						const content =
							await this.s3Service.downloadFile(remoteFile);
						if (typeof content === 'string') {
							await this.app.vault.modify(localFile, content, {
								mtime: remoteMtime,
							});
						} else {
							await this.app.vault.modifyBinary(localFile, content, {
								mtime: remoteMtime,
							});
						}
					}
					// If times are equal or no changes since last sync, do nothing.
				}
			}

			// Step 3: Process remote files not found locally (handle downloads)
			syncNotice.setMessage("S3 Sync: Checking for new remote files...");
			for (const [path, remoteFile] of remoteFiles.entries()) {
				if (!processedRemotePaths.has(path)) {
					// File exists remotely, but not locally -> Download
					syncNotice.setMessage(
						`S3 Sync: Downloading new file ${path}`,
					);
					const content =
						await this.s3Service.downloadFile(remoteFile);
					const folderPath = path.substring(0, path.lastIndexOf("/"));
					if (folderPath) {
						try {
							// This check avoids an error if the folder already exists.
							if (
								!this.app.vault.getAbstractFileByPath(
									folderPath,
								)
							) {
								await this.app.vault.createFolder(folderPath);
							}
						} catch (e) {
							/* Folder likely created between check and call, ignore */
						}
					}
					if (typeof content === 'string') {
						await this.app.vault.create(path, content, {
							mtime: remoteFile.LastModified!.getTime(),
						});
					} else {
						await this.app.vault.createBinary(path, content, {
							mtime: remoteFile.LastModified!.getTime(),
						});
					}
				}
			}

			// Step 4: Finalize sync by updating the timestamp
			this.plugin.settings.lastSyncTimestamp = newSyncTimestamp;
			await this.plugin.saveSettings();
			syncNotice.setMessage("S3 Sync: Sync complete!");
		} catch (error) {
			console.error("S3 Sync Error:", error);
			syncNotice.setMessage(
				`S3 Sync: Error during sync. Check console for details.`,
			);
		} finally {
			this.running = false;
			// Hide the notice after 5 seconds
			setTimeout(() => syncNotice.hide(), 5000);
		}
	}

	private getLocalFiles(): Map<string, TFile> {
		const localFiles = new Map<string, TFile>();
		this.app.vault.getFiles().forEach((file) => {
			// Ignore files/folders starting with a dot.
			if (
				!file.path.split("/").some((part) => part.startsWith("."))
			) {
				localFiles.set(file.path, file);
			}
		});
		return localFiles;
	}

	private async handleConflict(localFile: TFile, remoteFile: S3Object) {
		// Strategy: Download remote content to a new conflict file, then upload local content to the original path.
		const remoteContent = await this.s3Service.downloadFile(remoteFile);
		const conflictFileName = this.getConflictFileName(
			localFile.path,
			new Date(remoteFile.LastModified!.getTime()),
		);

		// Save the remote version with a new name.
		if (typeof remoteContent === 'string') {
			await this.app.vault.create(conflictFileName, remoteContent, {
				mtime: remoteFile.LastModified!.getTime(),
			});
		} else {
			await this.app.vault.createBinary(conflictFileName, remoteContent, {
				mtime: remoteFile.LastModified!.getTime(),
			});
		}
		new Notice(
			`S3 Sync: Saved remote version of ${localFile.basename} as ${conflictFileName}`,
		);

		// Upload the local version to overwrite the remote original, ensuring the user's latest local changes are preserved in the cloud.
		const localContent = this.isBinaryFile(localFile.path) 
			? await this.app.vault.readBinary(localFile)
			: await this.app.vault.read(localFile);
		await this.s3Service.uploadFile(localFile, localContent);
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

	private isBinaryFile(filePath: string): boolean {
		const binaryExtensions = [
			'png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp',  // Images
			'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', // Documents
			'zip', 'rar', '7z', 'tar', 'gz',  // Archives
			'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv',  // Media
			'exe', 'dmg', 'app',  // Executables
			'bin', 'dat', 'db', 'sqlite',  // Data files
		];
		
		const extension = filePath.split('.').pop()?.toLowerCase();
		return extension ? binaryExtensions.includes(extension) : false;
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
