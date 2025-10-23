import { App, TFolder, TFile, Plugin } from "obsidian";
import { SyncState } from "./SyncTypes";

/**
 * Manages the sync state using Obsidian's Plugin Data API
 */
export class SyncStateManager {
	private readonly LEGACY_STATE_DIR = ".kisss3";
	private readonly LEGACY_STATE_FILE_PATH = `${this.LEGACY_STATE_DIR}/sync-state.json`;
	private readonly SYNC_STATE_KEY = "syncState";
	
	constructor(private app: App, private plugin: Plugin) {}

	/**
	 * Loads the sync state from plugin data API, with migration from legacy file
	 * @returns SyncState object or empty object if no state exists
	 */
	async loadState(): Promise<SyncState> {
		try {
			// First try to load from plugin data API
			const pluginData = await this.plugin.loadData();
			if (pluginData?.[this.SYNC_STATE_KEY]) {
				return pluginData[this.SYNC_STATE_KEY] as SyncState;
			}

			// If no plugin data, try to migrate from legacy file
			const legacyState = await this.migrateLegacyState();
			if (legacyState && Object.keys(legacyState).length > 0) {
				// Save migrated state to plugin data API
				await this.saveState(legacyState);
				console.info("S3 Sync: Successfully migrated legacy sync state to plugin data API");
				return legacyState;
			}

			// No state found anywhere, return empty state
			return {};
		} catch (error) {
			console.warn(
				"S3 Sync: Could not load sync state, starting with empty state:",
				error,
			);
			return {};
		}
	}

	/**
	 * Saves the sync state to plugin data API
	 * @param state The sync state to save
	 */
	async saveState(state: SyncState): Promise<void> {
		try {
			console.info("Saving sync state...");
			
			// Load existing plugin data to preserve other data
			const pluginData = await this.plugin.loadData();
			const safePluginData = pluginData ?? {};
			
			// Update sync state in plugin data
			safePluginData[this.SYNC_STATE_KEY] = state;
			
			// Save back to plugin data API
			await this.plugin.saveData(safePluginData);
			
			console.info("S3 Sync: Successfully saved sync state to plugin data API");
		} catch (error) {
			console.error("S3 Sync: Failed to save sync state:", error);
			throw new Error(`Failed to save sync state: ${error.message}`);
		}
	}

	/**
	 * Migrates legacy sync state from .kisss3/sync-state.json if present
	 * @returns Legacy SyncState or empty object if no legacy file exists
	 */
	private async migrateLegacyState(): Promise<SyncState> {
		try {
			const legacyStateFile = this.app.vault.getAbstractFileByPath(
				this.LEGACY_STATE_FILE_PATH,
			);
			if (!legacyStateFile || legacyStateFile instanceof TFolder) {
				// Legacy file doesn't exist or is a folder
				return {};
			}

			const content = await this.app.vault.read(legacyStateFile as TFile);
			const legacyState = JSON.parse(content) as SyncState;

			// Remove the legacy state file after successful migration
			try {
				await this.app.vault.delete(legacyStateFile);
				console.info("S3 Sync: Removed legacy sync state file after migration");
			} catch (deleteError) {
				console.warn("S3 Sync: Could not remove legacy state file:", deleteError);
			}

			// Try to remove the legacy directory if it's empty
			try {
				const legacyDir = this.app.vault.getAbstractFileByPath(this.LEGACY_STATE_DIR);
				if (legacyDir instanceof TFolder && legacyDir.children.length === 0) {
					await this.app.vault.delete(legacyDir);
					console.info("S3 Sync: Removed empty legacy sync state directory");
				}
			} catch (deleteDirError) {
				console.warn("S3 Sync: Could not remove legacy state directory:", deleteDirError);
			}

			return legacyState;
		} catch (error) {
			console.warn("S3 Sync: Could not migrate legacy sync state:", error);
			return {};
		}
	}

	/**
	 * Clears the sync state (useful for testing or reset scenarios)
	 */
	async clearState(): Promise<void> {
		await this.saveState({});
	}
}
