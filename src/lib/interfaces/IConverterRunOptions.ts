export interface IConverterRunOptions {
  input: string;
  output: string;
  metadataFile?: string;
  copySongsMetadataToOutput?: boolean;
  processFormats?: string;
  processBitrate?: string;
  processConcurrency?: string;
  processUpdateConcurrency?: string;
  images?: boolean;
  lyrics?: boolean;
  exitOnError?: boolean;
  reconvertBefore?: string;
  reconvertAfter?: string;
  reconvertMissing?: boolean;
}
