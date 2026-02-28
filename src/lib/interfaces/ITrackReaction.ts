export interface ITrackReaction {
  play_count: number;
  skip_count: number;
  flagged: boolean;
  flagged_reason?: string;
  reaction_type?: string;
  clip: string;
  updated_at: string;
}
