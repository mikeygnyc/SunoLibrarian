export interface Track {
  id: string;
  title: string;
  audio_url: string;
  status: string;
  metadata?: any;
  workspaceId?: string;
  workspaceName?: string;
  type?: string;
  is_stem?: boolean;
  created_at?: string;
  duration?: number;
}

export interface Workspace {
  id: string;
  name: string;
}

export interface TrackMetadata {
  title?: string | null;
  id?: string;
  lyrics?: string | null;
  bpm?: number | null;
  key?: string | null;
  prompt?: string | null;
  coverArt?: string | null;
  duration?: number | null;
  tags?: string | null;
  genre?: string | null;
  artist?: string | null;
  fullData?: any;
}
