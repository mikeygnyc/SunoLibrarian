import { ISongData } from "./types";

export function normalizeMetadata(meta: ISongData): ISongData {
  // operate on the object in place rather than producing a new copy.
  // callers often retain references to the original song, so creating a
  // fresh object caused later modifications (eg. timestamp updates) to
  // be lost when the array was re‑assigned during persistence.
  const normalized = meta;

  // Check if upload
  normalized.upload = normalized.rawApiResponse?.metadata?.type === "upload";

  // Derive artistName from display_name if missing
  if (!normalized.artistName || normalized.artistName === "Unknown Artist") {
    normalized.artistName = normalized.rawApiResponse?.display_name || "Unknown Artist";
  }

  // Derive model from major_model_version (null for uploads, always recalculate)
  if (normalized.upload) {
    normalized.model = null;
  } else {
    const modelName = normalized.rawApiResponse?.model_name;
    const majorVersion = normalized.rawApiResponse?.major_model_version;
    if (modelName && majorVersion) {
      normalized.model = `Suno ${majorVersion} (${modelName})`;
    } else {
      normalized.model = majorVersion || modelName || null;
    }
  }

  // Derive liked from is_liked
  if (normalized.rawApiResponse?.is_liked != null && normalized.liked == null) {
    normalized.liked = normalized.rawApiResponse.is_liked;
  }

  // Derive duration from raw duration (seconds to MM:SS)
  if (!normalized.duration && normalized.rawApiResponse?.metadata?.duration) {
    const minutes = Math.floor(normalized.rawApiResponse.metadata.duration / 60);
    const seconds = Math.floor(normalized.rawApiResponse.metadata.duration % 60);
    normalized.duration = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  // Derive weirdness from control_sliders (default 50%)
  if (normalized.weirdness == null) {
    const weirdness = normalized.rawApiResponse?.metadata?.control_sliders?.weirdness_constraint;
    normalized.weirdness = weirdness != null ? Math.round(weirdness * 100) : 50;
  }

  // Derive styleStrength from control_sliders (default 50%)
  if (normalized.styleStrength == null) {
    const styleWeight = normalized.rawApiResponse?.metadata?.control_sliders?.style_weight;
    normalized.styleStrength = styleWeight != null ? Math.round(styleWeight * 100) : 50;
  }

  // Derive audioStrength from control_sliders (default 50%)
  if (normalized.audioStrength == null) {
    const audioWeight = normalized.rawApiResponse?.metadata?.control_sliders?.audio_weight;
    normalized.audioStrength = audioWeight != null ? Math.round(audioWeight * 100) : 50;
  }

  // Derive creationDate from created_at
  if (!normalized.creationDate && normalized.rawApiResponse?.created_at) {
    normalized.creationDate = new Date(normalized.rawApiResponse.created_at);
  }

  // Handle "Untitled" title - extract from lyrics
  if (!normalized.title || normalized.title === "Untitled") {
    if (normalized.lyrics || normalized.rawApiResponse?.metadata?.prompt) {
      const lyrics = normalized.lyrics || normalized.rawApiResponse?.metadata?.prompt || "";
      const lines = lyrics.split("\n");
      let titleText = "";
      for (const line of lines) {
        const cleaned = line.replace(/\[.*?\]|\(.*?\)/g, "").trim();
        if (cleaned && !line.match(/^\[.*\]$/)) {
          titleText = cleaned;
          break;
        }
      }
      normalized.title = titleText.substring(0, 100).trim() || "Untitled";
    }
  }

  // Ensure thumbnail matches image_large_url
  if (normalized.rawApiResponse?.image_large_url) {
    normalized.thumbnail = normalized.rawApiResponse.image_large_url;
  }

  // Set style from metadata.tags
  normalized.style = normalized.rawApiResponse?.metadata?.tags || null;

  // Set tags from display_tags
  normalized.tags = splitTags(normalized.rawApiResponse?.display_tags);

  // Set remixParent from cover_clip_id
  normalized.remixParent = normalized.rawApiResponse?.metadata?.cover_clip_id || undefined;

  // Populate new fields
  normalized.negativeTags = splitTags(normalized.rawApiResponse?.metadata?.negative_tags);
  normalized.isHidden = normalized.rawApiResponse?.is_hidden || false;
  normalized.gptDescriptionPrompt = normalized.rawApiResponse?.metadata?.gpt_description_prompt || null;
  normalized.mashupSource = normalized.rawApiResponse?.metadata?.mashup_clip_ids || [];
  normalized.personaId = normalized.rawApiResponse?.persona?.id || null;
  normalized.personaName = normalized.rawApiResponse?.persona?.name || null;
  normalized.projectName = normalized.rawApiResponse?.project?.name || null;
  normalized.explicit = normalized.rawApiResponse?.explicit || false;
  normalized.flaggedReason = normalized.rawApiResponse?.reaction?.flagged_reason || null;

  // preserve/initialize timestamp fields (they may be undefined coming
  // from older metadata or when first downloaded).
  if (normalized.mp3Timestamp == null) normalized.mp3Timestamp = null;
  if (normalized.wavTimestamp == null) normalized.wavTimestamp = null;
  if (normalized.alacTimestamp == null) normalized.alacTimestamp = null;
  if (normalized.flacTimestamp == null) normalized.flacTimestamp = null;

  return normalized;
}

export function splitTags(tags: string | undefined): string[] {
  if (!tags) return [];
  return tags.split(",").map(t => t.trim()).filter(t => t);
}
