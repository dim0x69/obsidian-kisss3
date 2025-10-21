// --- Plugin Settings Interface ---
export interface S3SyncSettings {
	endpoint: string;
	region: string;
	bucketName: string;
	accessKeyId: string;
	secretAccessKey: string;
	remotePrefix: string;
	syncIntervalMinutes: number;
	enableAutomaticSync: boolean;
	lastSyncTimestamp: number;
}

// --- Default Settings ---
export const DEFAULT_SETTINGS: S3SyncSettings = {
	endpoint: "",
	region: "",
	bucketName: "",
	accessKeyId: "",
	secretAccessKey: "",
	remotePrefix: "",
	syncIntervalMinutes: 15,
	enableAutomaticSync: false,
	lastSyncTimestamp: 0,
};
