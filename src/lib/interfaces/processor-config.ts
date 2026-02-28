export type AudioFormat = "flac" | "alac" | "mp3" | "wav";

export interface ProcessorConfig {
  inputRoot: string;
  outputRoot: string;
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
}
