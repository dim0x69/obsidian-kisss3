import { TFile } from "obsidian";
import {
	S3Client,
	ListObjectsV2Command,
	ListObjectsV2CommandOutput,
	GetObjectCommand,
	PutObjectCommand,
	DeleteObjectCommand,
	HeadObjectCommand,
	_Object as S3Object, // Alias to avoid conflict with Object
} from "@aws-sdk/client-s3";

import { S3SyncSettings } from "../settings";
import S3SyncPlugin from "../main";
import { ObsHttpHandler } from "./ObsHttpHandler";

// Manages all interactions with the S3-compatible object storage.
export class S3Service {
	private client: S3Client | null = null;

	constructor(private settings: S3SyncSettings, private plugin: S3SyncPlugin) {
		this.initializeClient();
	}

	private initializeClient() {
		if (
			this.settings.endpoint &&
			this.settings.region &&
			this.settings.accessKeyId &&
			this.settings.secretAccessKey &&
			this.settings.bucketName
		) {
			this.client = new S3Client({
				endpoint: this.settings.endpoint,
				region: this.settings.region,
				credentials: {
					accessKeyId: this.settings.accessKeyId,
					secretAccessKey: this.settings.secretAccessKey,
				},
				// Use our custom HTTP handler that leverages Obsidian's requestUrl API
				requestHandler: new ObsHttpHandler(),
			});
		} else {
			this.client = null;
		}
	}

	// Re-initializes the client if settings are updated.
	updateSettings(newSettings: S3SyncSettings) {
		this.settings = newSettings;
		this.initializeClient();
	}

	isConfigured(): boolean {
		return this.client !== null;
	}

	private getRemoteKey(localPath: string): string {
		const prefix = this.settings.remotePrefix.trim();
		// Ensure prefix, if it exists, ends with a slash.
		if (prefix && !prefix.endsWith("/")) {
			return `${prefix}/${localPath}`;
		}
		return `${prefix}${localPath}`;
	}

	private getLocalPath(remoteKey: string): string {
		const prefix = this.settings.remotePrefix.trim();
		// Remove prefix to get the relative path matching the vault structure.
		if (prefix && !prefix.endsWith("/")) {
			return remoteKey.substring(prefix.length + 1);
		}
		return remoteKey.substring(prefix.length);
	}

	async listRemoteFiles(): Promise<Map<string, S3Object>> {
		const remoteFiles = new Map<string, S3Object>();
		if (!this.isConfigured()) throw new Error("S3 client not configured.");

		let continuationToken: string | undefined = undefined;
		let isTruncated = true;
		if (this.plugin.settings.enableDebugLogging) {
			console.log(
				`listRemoteFiles(), bucket: ${this.settings.bucketName}, prefix: ${this.settings.remotePrefix}`,
			);
		}
		while (isTruncated) {
			const command = new ListObjectsV2Command({
				Bucket: this.settings.bucketName,
				Prefix: this.settings.remotePrefix.trim(),
				ContinuationToken: continuationToken,
			});

			const response: ListObjectsV2CommandOutput =
				await this.client!.send(command);

			response.Contents?.forEach((obj: S3Object) => {
				if (obj.Key) {
					// Don't include the folder marker object itself.
					if (
						obj.Key.endsWith("/") &&
						this.getLocalPath(obj.Key) === ""
					)
						return;

					const relativePath = this.getLocalPath(obj.Key);

					// Apply exclusion rule: ignore files/folders starting with a dot
					if (!this.shouldIgnoreFile(relativePath)) {
						remoteFiles.set(relativePath, obj);
					}
				}
			});

			isTruncated = response.IsTruncated ?? false;
			continuationToken = response.NextContinuationToken;
		}
		if (this.plugin.settings.enableDebugLogging) {
			console.log(`listRemoteFiles(),found ${remoteFiles.size} files`);
		}
		return remoteFiles;
	}

	async uploadFile(file: TFile, content: ArrayBuffer): Promise<number> {
		if (!this.isConfigured()) throw new Error("S3 client not configured.");

		const body = new Uint8Array(content);
		if (this.plugin.settings.enableDebugLogging) {
			console.log(
				`uploadFile(${file.path}), bucket: ${this.settings.bucketName}, key: ${this.getRemoteKey(file.path)}`,
			);
		}
		const command = new PutObjectCommand({
			Bucket: this.settings.bucketName,
			Key: this.getRemoteKey(file.path),
			Body: body,
			ContentLength: body.length,
			ContentType: "application/octet-stream", // Always use octet-stream
		});

		await this.client!.send(command);

		// After upload, retrieve the actual LastModified timestamp from S3 using HeadObject
		return await this.getFileMetadata(file.path);
	}

	/**
	 * Gets the metadata for a specific file from S3 using HeadObject
	 */
	async getFileMetadata(filePath: string): Promise<number> {
		if (!this.isConfigured()) throw new Error("S3 client not configured.");
		if (this.plugin.settings.enableDebugLogging) {
			console.log(`getFileMetadata(${filePath})`);
		}
		const command = new HeadObjectCommand({
			Bucket: this.settings.bucketName,
			Key: this.getRemoteKey(filePath),
		});

		const response = await this.client!.send(command);

		if (response.LastModified) {
			return response.LastModified.getTime();
		}

		// Fallback to current time if LastModified is not available
		console.error(`LastModified not available for ${filePath}`);
		return Date.now();
	}

	async downloadFile(s3Object: S3Object): Promise<ArrayBuffer> {
		if (!this.isConfigured()) throw new Error("S3 client not configured.");

		const command = new GetObjectCommand({
			Bucket: this.settings.bucketName,
			Key: s3Object.Key,
		});

		const response = await this.client!.send(command);
		const byteArray = await response.Body?.transformToByteArray();

		if (!byteArray) return new ArrayBuffer(0);

		// Ensure the returned buffer is an ArrayBuffer, not just ArrayBufferLike
		if (byteArray.buffer instanceof ArrayBuffer) {
			return byteArray.buffer;
		} else {
			// Copy to a new ArrayBuffer if it's a SharedArrayBuffer or other ArrayBufferLike
			return byteArray.slice().buffer;
		}
	}

	async deleteRemoteFile(path: string): Promise<void> {
		if (!this.isConfigured()) throw new Error("S3 client not configured.");

		const command = new DeleteObjectCommand({
			Bucket: this.settings.bucketName,
			Key: this.getRemoteKey(path),
		});

		await this.client!.send(command);
	}

	/**
	 * Checks if a file should be ignored based on exclusion rules
	 */
	private shouldIgnoreFile(filePath: string): boolean {
		// Ignore files/folders beginning with a dot
		return filePath.split("/").some((part) => part.startsWith("."));
	}
}
