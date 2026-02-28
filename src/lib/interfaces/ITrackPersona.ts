export interface ITrackPersona {
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
