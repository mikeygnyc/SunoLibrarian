export interface ITrack {
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
