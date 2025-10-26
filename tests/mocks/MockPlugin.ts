import { S3SyncSettings } from '../../settings';

export class MockPlugin {
  public settings: S3SyncSettings = {
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key',
    bucketName: 'test-bucket',
    region: 'us-east-1',
    endpoint: 'https://s3.amazonaws.com',
    remotePrefix: '',
    syncIntervalMinutes: 15,
    enableAutomaticSync: false,
    enableDebugLogging: false,
  };

  private pluginData: any = {};

  constructor(settings?: Partial<S3SyncSettings>) {
    if (settings) {
      this.settings = { ...this.settings, ...settings };
    }
  }

  async loadData(): Promise<any> {
    return Promise.resolve(this.pluginData);
  }

  async saveData(data: any): Promise<void> {
    this.pluginData = { ...data };
    return Promise.resolve();
  }

  setPluginData(data: any): void {
    this.pluginData = data;
  }

  getPluginData(): any {
    return this.pluginData;
  }

  clearData(): void {
    this.pluginData = {};
  }
}