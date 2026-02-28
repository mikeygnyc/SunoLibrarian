import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ICacheData, ITrack, ITrackMetadata } from './lib/interfaces';

const STORAGE_DIR = path.join(os.homedir(), '.suno-export');
const CACHE_FILE = path.join(STORAGE_DIR, 'cache.json');

export class Storage {
  private cache: ICacheData;

  constructor() {
    this.ensureStorageDir();
    this.cache = this.loadCache();
  }

  private ensureStorageDir(): void {
    if (!fs.existsSync(STORAGE_DIR)) {
      fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
  }

  private loadCache(): ICacheData {
    if (fs.existsSync(CACHE_FILE)) {
      try {
        return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      } catch (error) {
        console.warn('Failed to load cache, starting fresh');
      }
    }
    return { tracks: {}, timestamps: {}, metadata: {} };
  }

  private saveCache(): void {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(this.cache, null, 2));
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

  clearAll(): void {
    this.cache = { tracks: {}, timestamps: {}, metadata: {} };
    this.saveCache();
  }

  clearCache(): void {
    this.clearAll();
  }
}
