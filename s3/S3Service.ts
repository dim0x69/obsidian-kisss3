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

	async uploadFile(file: TFile, content: ArrayBuffer): Promise<void> {
		if (!this.isConfigured()) throw new Error("S3 client not configured.");

		const body = new Uint8Array(content);
		const contentType = this.getMimeType(file.path);

		const command = new PutObjectCommand({
			Bucket: this.settings.bucketName,
			Key: this.getRemoteKey(file.path),
			Body: body,
			ContentLength: body.length,
			ContentType: contentType,
		});

		await this.client!.send(command);
	}

	async downloadFile(s3Object: S3Object): Promise<ArrayBuffer> {
		if (!this.isConfigured()) throw new Error("S3 client not configured.");

		const command = new GetObjectCommand({
			Bucket: this.settings.bucketName,
			Key: s3Object.Key,
		});

		const response = await this.client!.send(command);
		const byteArray = await response.Body?.transformToByteArray();
		return byteArray?.buffer ?? new ArrayBuffer(0);
	}

	private getMimeType(filePath: string): string {
		const extension = filePath.split('.').pop()?.toLowerCase();
		
		const mimeTypes: { [key: string]: string } = {
			// Text files
			'md': 'text/markdown',
			'txt': 'text/plain',
			'json': 'application/json',
			'js': 'application/javascript',
			'ts': 'application/typescript',
			'css': 'text/css',
			'html': 'text/html',
			'xml': 'application/xml',
			'csv': 'text/csv',
			
			// Images
			'png': 'image/png',
			'jpg': 'image/jpeg',
			'jpeg': 'image/jpeg',
			'gif': 'image/gif',
			'bmp': 'image/bmp',
			'svg': 'image/svg+xml',
			'webp': 'image/webp',
			'ico': 'image/x-icon',
			
			// Documents
			'pdf': 'application/pdf',
			'doc': 'application/msword',
			'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			'xls': 'application/vnd.ms-excel',
			'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'ppt': 'application/vnd.ms-powerpoint',
			'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
			
			// Archives
			'zip': 'application/zip',
			'rar': 'application/vnd.rar',
			'7z': 'application/x-7z-compressed',
			'tar': 'application/x-tar',
			'gz': 'application/gzip',
			
			// Media
			'mp3': 'audio/mpeg',
			'mp4': 'video/mp4',
			'wav': 'audio/wav',
			'avi': 'video/x-msvideo',
			'mov': 'video/quicktime',
			'mkv': 'video/x-matroska',
		};
		
		return extension ? (mimeTypes[extension] || 'application/octet-stream') : 'application/octet-stream';
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
