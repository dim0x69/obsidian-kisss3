// Import necessary modules from Obsidian
import { Plugin, TFile } from "obsidian";

// Import local modules
import { S3SyncSettings, DEFAULT_SETTINGS } from "./settings";
import { SyncManager } from "./sync/SyncManager";
import { S3SyncSettingTab } from "./ui/S3SyncSettingTab";

export default class S3SyncPlugin extends Plugin {
	settings: S3SyncSettings;
	private syncManager: SyncManager;
	private syncIntervalId: number | null = null;

	async onload() {
		await this.loadSettings();

		this.syncManager = new SyncManager(this.app, this);

		this.addSettingTab(new S3SyncSettingTab(this.app, this));

		this.addCommand({
			id: "s3-sync-now",
			name: "Sync Now",
			callback: () => {
				this.syncManager.runSync();
			},
		});

		// Register delete event handler for real-time sync
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					this.syncManager.handleLocalDelete(file.path);
				}
			})
		);

		this.updateSyncInterval();
	}

	onunload() {
		if (this.syncIntervalId !== null) {
			window.clearInterval(this.syncIntervalId);
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Inform the sync manager and scheduler of setting changes.
		this.syncManager.updateSettings(this.settings);
		this.updateSyncInterval();
	}

	updateSyncInterval() {
		// Clear any existing interval to prevent duplicates.
		if (this.syncIntervalId !== null) {
			window.clearInterval(this.syncIntervalId);
			this.syncIntervalId = null;
		}

		if (
			this.settings.enableAutomaticSync &&
			this.settings.syncIntervalMinutes > 0
		) {
			const intervalMillis =
				this.settings.syncIntervalMinutes * 60 * 1000;
			this.syncIntervalId = window.setInterval(() => {
				this.syncManager.runSync();
			}, intervalMillis);

			// Register the interval so Obsidian can manage it.
			this.registerInterval(this.syncIntervalId);
		}
	}
}
