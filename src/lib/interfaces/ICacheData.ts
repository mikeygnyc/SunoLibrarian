import type { ITrack } from "./ITrack";
import type { ITrackMetadata } from "./ITrackMetadata";

export interface ICacheData {
  tracks: Record<string, ITrack[]>;
  timestamps: Record<string, number>;
  metadata: Record<string, ITrackMetadata>;
  deviceId?: string;
  authToken?: string;
}
