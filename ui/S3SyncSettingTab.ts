import { App, PluginSettingTab, Setting, normalizePath } from "obsidian";
import S3SyncPlugin from "../main";

export class S3SyncSettingTab extends PluginSettingTab {
	plugin: S3SyncPlugin;

	constructor(app: App, plugin: S3SyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("S3 Endpoint")
			.setDesc("The endpoint URL of your S3-compatible storage.")
			.addText((text) =>
				text
					.setPlaceholder("https://s3.amazonaws.com")
					.setValue(this.plugin.settings.endpoint)
					.onChange(async (value) => {
						this.plugin.settings.endpoint = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("S3 Region")
			.setDesc(
				'The region of your S3 bucket (e.g., "us-east-1", "auto").',
			)
			.addText((text) =>
				text
					.setPlaceholder("us-east-1")
					.setValue(this.plugin.settings.region)
					.onChange(async (value) => {
						this.plugin.settings.region = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Bucket Name")
			.setDesc("The name of the S3 bucket.")
			.addText((text) =>
				text
					.setPlaceholder("my-obsidian-vault")
					.setValue(this.plugin.settings.bucketName)
					.onChange(async (value) => {
						this.plugin.settings.bucketName = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Access Key ID")
			.setDesc("Your S3 access key.")
			.addText((text) =>
				text
					.setPlaceholder("AKIA...")
					.setValue(this.plugin.settings.accessKeyId)
					.onChange(async (value) => {
						this.plugin.settings.accessKeyId = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Secret Access Key")
			.setDesc("Your S3 secret key.")
			.addText((text) =>
				text
					.setPlaceholder("Your secret key")
					.setValue(this.plugin.settings.secretAccessKey)
					.onChange(async (value) => {
						this.plugin.settings.secretAccessKey = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Remote prefix (folder)")
			.setDesc(
				"Optional folder path in the bucket to sync to (e.g., `obsidian/`). Slashes are optional.",
			)
			.addText((text) =>
				text
					.setPlaceholder("my-vault")
					.setValue(this.plugin.settings.remotePrefix)
					.onChange(async (value) => {
						this.plugin.settings.remotePrefix = normalizePath(
							value.trim(),
						);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setHeading().setName("Automatic sync");

		new Setting(containerEl)
			.setName("Enable automatic sync")
			.setDesc("Enable syncing at a regular interval.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableAutomaticSync)
					.onChange(async (value) => {
						this.plugin.settings.enableAutomaticSync = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Sync interval (minutes)")
			.setDesc(
				"How often to sync automatically. Must be a number greater than 0.",
			)
			.addText((text) =>
				text
					.setPlaceholder("15")
					.setValue(
						this.plugin.settings.syncIntervalMinutes.toString(),
					)
					.onChange(async (value) => {
						const numValue = parseInt(value, 10);
						if (!isNaN(numValue) && numValue > 0) {
							this.plugin.settings.syncIntervalMinutes = numValue;
							await this.plugin.saveSettings();
						}
					}),
			);
		new Setting(containerEl).setHeading().setName("Debug");

		new Setting(containerEl)
			.setName("Enable debug logging")
			.setDesc("Enable logging to Obsidian's log file.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableDebugLogging)
					.onChange(async (value) => {
						this.plugin.settings.enableDebugLogging = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
