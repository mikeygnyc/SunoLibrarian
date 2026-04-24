export type AudioFormat = "flac" | "alac" | "mp3" | "wav";

export interface IProcessorConfig {
  inputRoot: string;
  outputRoot: string;
  assertNotCancelled?: () => Promise<void> | void;
  abortSignal?: AbortSignal;
  metadataDatabaseType?: "sqlite" | "postgres";
  metadataDatabasePath?: string;
  metadataPostgresUrl?: string;
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
