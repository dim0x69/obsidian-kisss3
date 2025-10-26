import { App } from "obsidian";
import { SyncState } from "./SyncTypes";
import S3SyncPlugin from "../main";

/**
 * Manages the sync state using Obsidian's Plugin Data API
 */
export class SyncStateManager {
	private readonly SYNC_STATE_KEY = "syncState";

	constructor(
		private app: App,
		private plugin: S3SyncPlugin,
	) {}

	/**
	 * Loads the sync state from plugin data API
	 * @returns SyncState object or empty object if no state exists
	 */
	async loadState(): Promise<SyncState> {
		try {
			const pluginData = await this.plugin.loadData();
			if (pluginData?.[this.SYNC_STATE_KEY]) {
				return pluginData[this.SYNC_STATE_KEY] as SyncState;
			}

			// No state found, return empty state
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
			if (this.plugin.settings.enableDebugLogging) {
				console.info("Saving sync state...");
			}
			// Load existing plugin data to preserve other data
			const pluginData = await this.plugin.loadData();
			const safePluginData = pluginData ?? {};

			// Update sync state in plugin data
			safePluginData[this.SYNC_STATE_KEY] = state;

			// Save back to plugin data API
			await this.plugin.saveData(safePluginData);
			if (this.plugin.settings.enableDebugLogging) {
				console.log(
					"S3 Sync: Successfully saved sync state to plugin data API",
				);
			}
		} catch (error) {
			console.error("S3 Sync: Failed to save sync state:", error);
			throw new Error(`Failed to save sync state: ${error.message}`);
		}
	}

	/**
	 * Clears the sync state (useful for testing or reset scenarios)
	 */
	async clearState(): Promise<void> {
		await this.saveState({});
	}
}
