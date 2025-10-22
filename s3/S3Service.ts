import { TFile } from "obsidian";
import {
	S3Client,
	ListObjectsV2Command,
	ListObjectsV2CommandOutput,
	GetObjectCommand,
	PutObjectCommand,
	DeleteObjectCommand,
	_Object as S3Object, // Alias to avoid conflict with Object
} from "@aws-sdk/client-s3";
import { S3SyncSettings } from "../settings";

// Manages all interactions with the S3-compatible object storage.
export class S3Service {
	private client: S3Client | null = null;

	constructor(private settings: S3SyncSettings) {
		this.initializeClient();
	}

	private initializeClient() {
		if (
			this.settings.endpoint &&
			this.settings.region &&
			this.settings.accessKeyId &&
			this.settings.secretAccessKey
		) {
			this.client = new S3Client({
				endpoint: this.settings.endpoint,
				region: this.settings.region,
				credentials: {
					accessKeyId: this.settings.accessKeyId,
					secretAccessKey: this.settings.secretAccessKey,
				},
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
		if (!this.isConfigured() || !this.settings.bucketName) {
			throw new Error("S3 client is not configured.");
		}

		// https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-s3/Interface/ListObjectsV2CommandOutput/
		// https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-s3/Class/ListObjectsV2Command/

		const remoteFiles = new Map<string, S3Object>();
		let isTruncated = true;
		let continuationToken: string | undefined = undefined;

		// Loop to handle pagination of S3 results.
		while (isTruncated) {
			const command: ListObjectsV2Command = new ListObjectsV2Command({
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
					remoteFiles.set(relativePath, obj);
				}
			});

			isTruncated = response.IsTruncated ?? false;
			continuationToken = response.NextContinuationToken;
		}
		return remoteFiles;
	}

	async uploadFile(file: TFile, content: string | ArrayBuffer): Promise<void> {
		if (!this.isConfigured()) throw new Error("S3 client not configured.");

		let body: Uint8Array;
		if (typeof content === 'string') {
			body = new TextEncoder().encode(content);
		} else {
			body = new Uint8Array(content);
		}

		const command = new PutObjectCommand({
			Bucket: this.settings.bucketName,
			Key: this.getRemoteKey(file.path),
			Body: body,
			ContentLength: body.length,
		});

		await this.client!.send(command);
	}

	async downloadFile(s3Object: S3Object): Promise<string | ArrayBuffer> {
		if (!this.isConfigured()) throw new Error("S3 client not configured.");

		const command = new GetObjectCommand({
			Bucket: this.settings.bucketName,
			Key: s3Object.Key,
		});

		const response = await this.client!.send(command);
		
		// Try to detect if this is a binary file based on the key (file extension)
		const localPath = this.getLocalPath(s3Object.Key!);
		if (this.isBinaryFile(localPath)) {
			const byteArray = await response.Body?.transformToByteArray();
			return byteArray?.buffer ?? new ArrayBuffer(0);
		} else {
			return response.Body?.transformToString() ?? "";
		}
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

	async deleteRemoteFile(path: string): Promise<void> {
		if (!this.isConfigured()) throw new Error("S3 client not configured.");

		const command = new DeleteObjectCommand({
			Bucket: this.settings.bucketName,
			Key: this.getRemoteKey(path),
		});

		await this.client!.send(command);
	}
}
