import { App, TFolder, TFile } from "obsidian";
import { SyncState } from "./SyncTypes";

/**
 * Manages the sync state file (.obsidian/plugins/kisss3/sync-state.json)
 */
export class SyncStateManager {
	private readonly STATE_FILE_PATH = ".obsidian/plugins/kisss3/sync-state.json";

	constructor(private app: App) {}

	/**
	 * Loads the sync state from the state file
	 * @returns SyncState object or empty object if file doesn't exist
	 */
	async loadState(): Promise<SyncState> {
		try {
			const stateFile = this.app.vault.getAbstractFileByPath(this.STATE_FILE_PATH);
			if (!stateFile || stateFile instanceof TFolder) {
				// File doesn't exist or is a folder
				return {};
			}

			const content = await this.app.vault.read(stateFile as TFile);
			return JSON.parse(content) as SyncState;
		} catch (error) {
			console.warn("S3 Sync: Could not load sync state, starting with empty state:", error);
			return {};
		}
	}

	/**
	 * Saves the sync state to the state file
	 * @param state The sync state to save
	 */
	async saveState(state: SyncState): Promise<void> {
		try {
			// Ensure the plugin directory exists
			await this.ensurePluginDirectoryExists();

			const content = JSON.stringify(state, null, 2);
			const stateFile = this.app.vault.getAbstractFileByPath(this.STATE_FILE_PATH);

			if (stateFile && !(stateFile instanceof TFolder)) {
				// File exists, modify it
				await this.app.vault.modify(stateFile as TFile, content);
			} else {
				// File doesn't exist, create it
				await this.app.vault.create(this.STATE_FILE_PATH, content);
			}
		} catch (error) {
			console.error("S3 Sync: Failed to save sync state:", error);
			throw new Error(`Failed to save sync state: ${error.message}`);
		}
	}

	/**
	 * Ensures the plugin directory exists
	 */
	private async ensurePluginDirectoryExists(): Promise<void> {
		const pluginDir = ".obsidian/plugins/kisss3";
		const existingDir = this.app.vault.getAbstractFileByPath(pluginDir);
		
		if (!existingDir) {
			try {
				await this.app.vault.createFolder(pluginDir);
			} catch (error) {
				// Ignore error if folder already exists (race condition)
				if (!(error instanceof Error && error.message.includes("already exists"))) {
					throw error;
				}
			}
		}
	}

	/**
	 * Clears the sync state (useful for testing or reset scenarios)
	 */
	async clearState(): Promise<void> {
		await this.saveState({});
	}
}