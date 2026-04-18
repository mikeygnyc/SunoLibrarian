import type { IControlSliders } from "./IControlSliders";
import type { IModelBadges } from "./IModelBadges";
import type { IBadge } from "./IBadge";

export interface ISunoTrackMetadata {
  tags?: string; //actually the prompt
  negative_tags?: string;
  prompt?: string; //actually lyrics
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
  control_sliders?: IControlSliders;
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
  model_badges?: IModelBadges;
  secondary_badges?: IBadge[];
  history?: any[];
  concat_history?: any[];
  infill?: boolean;
  infill_lyrics?: string;
  continue_at?: number;
  edit_session_id?: string;
  persona_id?: string;
  playlist_id?: string;
  mashup_clip_ids?: string[];
  is_mumble?: boolean;
}
