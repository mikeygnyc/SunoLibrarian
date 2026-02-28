export interface ControlSliders {
  audio_weight?: number;
  style_weight?: number;
  weirdness_constraint?: number;
}

export interface BadgeStyle {
  text_color: string;
  background_color: string;
  border_color: string;
}

export interface Badge {
  display_name: string;
  light: BadgeStyle;
  dark: BadgeStyle;
}

export interface ModelBadges {
  songcard?: Badge;
  songrow?: Badge;
}

export interface SunoTrackMetadata {
  tags?: string;
  negative_tags?: string;
  prompt?: string;
  gpt_description_prompt?: string;
  edited_clip_id?: string;
  artist_clip_id?: string;
  cover_clip_id?: string;
  overpainting_clip_id?: string;
  upsample_clip_id?: string;
  stem_from_id?: string;
  override_history_clip_id?: string;
  override_future_clip_id?: string;
  override_history_end_seconds?: number;
  override_future_start_seconds?: number;
  type?: string;
  duration?: number;
  refund_credits?: boolean;
  stream?: boolean;
  has_vocal?: boolean;
  can_publish_with_vocal?: boolean;
  make_instrumental?: boolean;
  control_sliders?: ControlSliders;
  task?: string;
  stem_task?: string;
  stem_type_id?: string;
  stem_type_group_name?: string;
  can_remix?: boolean;
  show_remix?: boolean;
  is_remix?: boolean;
  priority?: number;
  has_stem?: boolean;
  video_is_stale?: boolean;
  uses_latest_model?: boolean;
  is_audio_upload_tos_accepted?: boolean;
  is_loudness_under_threshold?: boolean;
  lyrics_updated?: boolean;
  model_badges?: ModelBadges;
  secondary_badges?: Badge[];
  history?: any[];
  concat_history?: any[];
  infill?: boolean;
  infill_lyrics?: string;
  continue_at?: number;
  edit_session_id?: string;
  persona_id?: string;
  playlist_id?: string;
  mashup_clip_ids?: string[];
}

export interface TrackReaction {
  play_count: number;
  skip_count: number;
  flagged: boolean;
  flagged_reason?: string;
  reaction_type?: string;
  clip: string;
  updated_at: string;
}

export interface TrackProject {
  id: string;
  name: string;
  description: string;
  is_trashed: boolean;
  is_public: boolean;
}

export interface TrackOwnership {
  ownership_reason: string;
}

export interface TrackPersona {
  id: string;
  name: string;
  image_s3_id: string;
  root_clip_id: string;
  user_handle: string;
  user_display_name: string;
  user_image_url: string;
  is_owned: boolean;
  is_public: boolean;
  is_trashed: boolean;
  is_hidden: boolean;
}

export interface SunoTrackResponse {
  status: string;
  title: string;
  play_count: number;
  upvote_count: number;
  allow_comments: boolean;
  id: string;
  entity_type: string;
  video_url: string;
  audio_url: string;
  image_url: string;
  image_large_url: string;
  major_model_version: string;
  model_name: string;
  metadata: SunoTrackMetadata;
  is_liked: boolean;
  user_id: string;
  display_name: string;
  handle: string;
  is_handle_updated: boolean;
  avatar_image_url: string;
  is_trashed: boolean;
  is_hidden?: boolean;
  created_at: string;
  is_public: boolean;
  reaction?: TrackReaction;
  is_following_creator: boolean;
  project?: TrackProject;
  ownership?: TrackOwnership;
  persona?: TrackPersona;
  explicit: boolean;
  comment_count: number;
  flag_count: number;
  display_tags?: string;
  is_contest_clip: boolean;
  has_hook: boolean;
  batch_index: number;
}

export type RawApiResponse = SunoTrackResponse;
