import type { Track, TrackMetadata } from "./client";

export interface CacheData {
  tracks: Record<string, Track[]>;
  timestamps: Record<string, number>;
  metadata: Record<string, TrackMetadata>;
  deviceId?: string;
  authToken?: string;
}
