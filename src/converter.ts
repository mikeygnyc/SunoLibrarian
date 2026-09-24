import * as path from "path";
import { IProcessorConfig, AudioFormat } from "./lib/interfaces";
import type { IConverterRunOptions } from "./lib/interfaces";
import * as logger from "./converter-logger";
import { Processor } from "./library-processor";
import { describeMetadataStoreConfig, resolveMetadataStoreConfig } from "./metadata-store";

export async function runConverter(options: IConverterRunOptions): Promise<void> {
  const metadataStoreConfig = resolveMetadataStoreConfig({
    databaseType: options.metadataDatabaseType,
    database: options.metadataDatabase,
    postgresUrl: options.metadataPostgresUrl,
  });
  const config: IProcessorConfig = {
    inputRoot: path.resolve(options.input),
    outputRoot: path.resolve(options.output),
    assertNotCancelled: options.assertNotCancelled,
    abortSignal: options.abortSignal,
    metadataDatabaseType: metadataStoreConfig.type,
    metadataDatabasePath: metadataStoreConfig.sqlitePath ?? metadataStoreConfig.jsonFilePath,
    metadataPostgresUrl: metadataStoreConfig.postgresUrl,
    metadataFilePath: options.metadataFile
      ? path.resolve(options.metadataFile)
      : path.join(path.resolve(options.output), "songs_metadata.json"),
    copySongsMetadataToOutput: options.copySongsMetadataToOutput === true,
    formats: (options.processFormats || "flac,mp3,alac")
      .split(",")
      .map((f: string) => f.trim()) as AudioFormat[],
    mp3Bitrate: parseInt(options.processBitrate || "320", 10),
    embedImages: options.images !== false,
    embedLyrics: options.lyrics !== false,
    exitOnError: options.exitOnError === true,
    reconvertBefore: options.reconvertBefore ? new Date(options.reconvertBefore) : undefined,
    reconvertAfter: options.reconvertAfter ? new Date(options.reconvertAfter) : undefined,
    reconvertMissing: options.reconvertMissing === true,
    processConcurrency: options.processConcurrency ? parseInt(options.processConcurrency, 10) : undefined,
    updateConcurrency: options.processUpdateConcurrency
      ? parseInt(options.processUpdateConcurrency, 10)
      : undefined,
    processClipIds: options.processClipIds,
  };

  if (config.reconvertMissing) {
    logger.log("Reconvert missing only mode enabled");
  }

  logger.init(config.inputRoot);
  logger.log("Suno Audio Processor");
  logger.log("===================");
  logger.log(`Input:  ${config.inputRoot}`);
  logger.log(`Output: ${config.outputRoot}`);
  logger.log(`Metadata store: ${describeMetadataStoreConfig(metadataStoreConfig)}`);
  logger.log(`Formats: ${config.formats.join(", ")}`);
  logger.log(`MP3 Bitrate: ${config.mp3Bitrate}kbps`);
  logger.log(`Embed Images: ${config.embedImages}`);
  logger.log(`Embed Lyrics: ${config.embedLyrics}`);
  if (config.processConcurrency) logger.log(`Processing concurrency: ${config.processConcurrency}`);
  if (config.updateConcurrency) logger.log(`Update concurrency: ${config.updateConcurrency}`);
  if (config.processClipIds?.length) logger.log(`Processing clips: ${config.processClipIds.length}`);
  if (config.reconvertBefore) logger.log(`Reconvert before: ${config.reconvertBefore.toISOString()}`);
  if (config.reconvertAfter) logger.log(`Reconvert after: ${config.reconvertAfter.toISOString()}`);
  logger.log("");

  const processor = new Processor(config);
  await processor.process();
  logger.log("\n✓ Processing complete");
}
