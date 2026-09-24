import * as path from "path";
import type { IConverterRunOptions } from "../lib/interfaces";
import type { MetadataStoreConfig } from "../metadata-store";
import type { CliOptions } from "./auth-service";

const DEFAULT_METADATA_FILENAME = "songs_metadata.json";

export class ProcessingPlannerService {
  createConverterRunOptions(
    options: CliOptions,
    storeConfig: MetadataStoreConfig,
    overrides: Partial<IConverterRunOptions> = {},
  ): IConverterRunOptions {
    const outputDir = path.resolve(String(options.output));
    return {
      input: String(options.input),
      output: outputDir,
      assertNotCancelled: options.__assertNotCancelled,
      abortSignal: options.__abortSignal,
      metadataDatabaseType: storeConfig.type,
      metadataDatabase: storeConfig.sqlitePath ?? storeConfig.jsonFilePath,
      metadataPostgresUrl: storeConfig.postgresUrl,
      metadataFile: this.resolveMetadataFilePath(outputDir, options),
      copySongsMetadataToOutput: options.copySongsMetadataToOutput === true,
      processFormats: options.processFormats,
      processBitrate: options.processBitrate,
      processConcurrency: toOptionalString(options.processConcurrency),
      processUpdateConcurrency: toOptionalString(options.processUpdateConcurrency),
      images: options.images,
      lyrics: options.lyrics,
      exitOnError: options.exitOnError,
      reconvertBefore: options.reconvertBefore,
      reconvertAfter: options.reconvertAfter,
      reconvertMissing: options.reconvertMissing,
      processClipIds: options.processClipIds,
      ...overrides,
    };
  }

  private resolveMetadataFilePath(rootDir: string, options: CliOptions): string {
    return typeof options.metadataFile === "string" && options.metadataFile.trim().length > 0
      ? path.resolve(options.metadataFile.trim())
      : path.join(rootDir, DEFAULT_METADATA_FILENAME);
  }
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}
