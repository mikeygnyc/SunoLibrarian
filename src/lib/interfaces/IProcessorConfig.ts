export type AudioFormat = "flac" | "alac" | "mp3" | "wav";

export interface IProcessorConfig {
  inputRoot: string;
  outputRoot: string;
  metadataFilePath?: string;
  copySongsMetadataToOutput?: boolean;
  formats: AudioFormat[];
  mp3Bitrate: number;
  embedImages: boolean;
  embedLyrics: boolean;
  exitOnError: boolean;
  reconvertBefore?: Date;
  reconvertAfter?: Date;
  reconvertMissing?: boolean;
  processConcurrency?: number;
  updateConcurrency?: number;
  processClipIds?: string[];
}
