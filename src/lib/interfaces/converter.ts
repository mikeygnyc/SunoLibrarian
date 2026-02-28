export interface ConverterRunOptions {
  input: string;
  output: string;
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
  imageList?: string;
}
