#!/usr/bin/env node
import { Command } from "commander";
import * as path from "path";
import { Processor } from "./processor";
import { ProcessorConfig, AudioFormat } from "./types";
import * as logger from "./logger"; // use our custom logger
import * as fs from "fs";


const program = new Command();

program
  .name("suno-process")
  .description("Process Suno audio files and embed metadata")
  .version("1.0.0")
  .requiredOption("-i, --input <path>", "Input root directory")
  .requiredOption("-o, --output <path>", "Output root directory")
  .option("-f, --formats <formats>", "Audio formats (comma-separated: flac,alac,mp3,wav)", "flac,mp3,alac")
  .option("-b, --bitrate <kbps>", "MP3 bitrate in kbps", "320")
  .option("--no-images", "Skip embedding images")
  .option("--no-lyrics", "Skip embedding lyrics")
  .option("--exit-on-error", "Exit immediately on processing errors")
  .option("-c, --concurrency <n>", "Processing concurrency (parallel files)", "4")
  .option("--update-concurrency <n>", "Concurrency when updating existing files", "8")
  .option("--reconvert-before <iso>", "Only reconvert formats whose timestamp is missing or on/before the given ISO date")
  .option("--reconvert-after <iso>", "Only reconvert formats whose timestamp is missing or on/after the given ISO date")
  .option("--reconvert-missing", "Only reconvert formats that are missing")
  .option("--image-list <file>", "Write JSON list of tracks whose images need downloading")
  .parse();

const opts = program.opts();

const config: ProcessorConfig = {
  inputRoot: path.resolve(opts.input),
  outputRoot: path.resolve(opts.output),
  formats: opts.formats.split(",").map((f: string) => f.trim()) as AudioFormat[],
  mp3Bitrate: parseInt(opts.bitrate),
  embedImages: opts.images !== false,
  embedLyrics: opts.lyrics !== false,
  exitOnError: opts.exitOnError === true,
  reconvertBefore: opts.reconvertBefore ? new Date(opts.reconvertBefore) : undefined,
  reconvertAfter: opts.reconvertAfter ? new Date(opts.reconvertAfter) : undefined,
  reconvertMissing: opts.reconvertMissing === true,
  processConcurrency: opts.concurrency ? parseInt(opts.concurrency) : undefined,
  updateConcurrency: opts.updateConcurrency ? parseInt(opts.updateConcurrency) : undefined,
};
if (opts.reconvertMissing) {
  logger.log("Reconvert missing only mode enabled");
}

// if user requested image list mode, perform that work and exit early
if (opts.imageList) {
  (async () => {
    const processor = new Processor(config);
    try {
      const list = await processor.getImagesNeedingDownload();
      const outFile = path.resolve(opts.imageList);
      fs.writeFileSync(outFile, JSON.stringify(list, null, 2));
      console.log(`Wrote ${list.length} images to ${outFile}`);
      process.exit(0);
    } catch (err: any) {
      console.error(`Failed to write image list: ${err.message || err}`);
      process.exit(1);
    }
  })().catch(err => {
    console.error("Unexpected error:", err);
    process.exit(1);
  });
} else {
  // initialize logger to ensure file is created before any messages
  // write the primary log (process.log) alongside the input data; the
  // output directory is meant for converted audio, so keeping logs with the
  // source makes filesystem cleanup simpler.
  logger.init(config.inputRoot);
  logger.log("Suno Audio Processor");
logger.log("===================");
logger.log(`Input:  ${config.inputRoot}`);
logger.log(`Output: ${config.outputRoot}`);
logger.log(`Formats: ${config.formats.join(", ")}`);
logger.log(`MP3 Bitrate: ${config.mp3Bitrate}kbps`);
logger.log(`Embed Images: ${config.embedImages}`);
logger.log(`Embed Lyrics: ${config.embedLyrics}`);
if (config.processConcurrency) logger.log(`Processing concurrency: ${config.processConcurrency}`);
if (config.updateConcurrency) logger.log(`Update concurrency: ${config.updateConcurrency}`);
if (config.reconvertBefore) {
  logger.log(`Reconvert before: ${config.reconvertBefore.toISOString()}`);
}
if (config.reconvertAfter) {
  logger.log(`Reconvert after: ${config.reconvertAfter.toISOString()}`);
}
logger.log("");

  const processor = new Processor(config);
  processor.process()
    .then(() => logger.log("\n✓ Processing complete"))
    .catch(err => {
      logger.error("\n✗ Error: " + err.message);
      process.exit(1);
    });
} // end else for image-list
