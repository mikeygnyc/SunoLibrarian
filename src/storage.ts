import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ICacheData, ITrack, ITrackMetadata } from './lib/interfaces';

export interface StorageOptions {
  cacheDir?: string;
}

export class Storage {
  private cache: ICacheData;
  private readonly storageDir: string;
  private readonly cacheFile: string;

  constructor(options: StorageOptions = {}) {
    this.storageDir = resolveStorageDir(options.cacheDir);
    this.cacheFile = path.join(this.storageDir, 'cache.json');
    this.ensureStorageDir();
    this.cache = this.loadCache();
  }

  private ensureStorageDir(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  private loadCache(): ICacheData {
    if (fs.existsSync(this.cacheFile)) {
      try {
        return JSON.parse(fs.readFileSync(this.cacheFile, 'utf-8'));
      } catch (error) {
        console.warn('Failed to load cache, starting fresh');
      }
    }
    return { tracks: {}, timestamps: {}, metadata: {} };
  }

  private saveCache(): void {
    fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache, null, 2));
  }

  cacheTracks(workspaceId: string, tracks: ITrack[]): void {
    this.cache.tracks[workspaceId] = tracks;
    this.cache.timestamps[workspaceId] = Date.now();
    this.saveCache();
  }

  getCachedTracks(workspaceId: string): { tracks: ITrack[]; timestamp: number } | null {
    if (this.cache.tracks[workspaceId]) {
      return {
        tracks: this.cache.tracks[workspaceId],
        timestamp: this.cache.timestamps[workspaceId] || 0,
      };
    }
    return null;
  }

  getCacheTimestamp(workspaceId: string): number | null {
    return this.cache.timestamps[workspaceId] || null;
  }

  cacheMetadata(trackId: string, metadata: ITrackMetadata): void {
    this.cache.metadata[trackId] = metadata;
    this.saveCache();
  }

  getCachedMetadata(trackId: string): ITrackMetadata | null {
    return this.cache.metadata[trackId] || null;
  }

  setDeviceId(deviceId: string): void {
    this.cache.deviceId = deviceId;
    this.saveCache();
  }

  getDeviceId(): string | null {
    return this.cache.deviceId || null;
  }

  setAuthToken(token: string): void {
    this.cache.authToken = token;
    this.saveCache();
  }

  getAuthToken(): string | null {
    return this.cache.authToken || null;
  }

  clearAuthToken(): void {
    delete this.cache.authToken;
    this.saveCache();
  }

  clearAll(): void {
    this.cache = { tracks: {}, timestamps: {}, metadata: {} };
    this.saveCache();
  }

  clearCache(): void {
    this.clearAll();
  }
}

function resolveStorageDir(configuredCacheDir?: string): string {
  const configuredRoot = configuredCacheDir?.trim()
    || process.env.SUNO_EXPORT_CACHE_DIR?.trim()
    || path.join(os.homedir(), '.suno-export');
  return path.join(configuredRoot, 'cache');
}
