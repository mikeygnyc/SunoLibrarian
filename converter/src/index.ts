#!/usr/bin/env node
import { Command } from "commander";
import * as path from "path";
import { Processor } from "./processor";
import { ProcessorConfig, AudioFormat } from "./types";

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
};

console.log("Suno Audio Processor");
console.log("===================");
console.log(`Input:  ${config.inputRoot}`);
console.log(`Output: ${config.outputRoot}`);
console.log(`Formats: ${config.formats.join(", ")}`);
console.log(`MP3 Bitrate: ${config.mp3Bitrate}kbps`);
console.log(`Embed Images: ${config.embedImages}`);
console.log(`Embed Lyrics: ${config.embedLyrics}`);
console.log();

const processor = new Processor(config);
processor.process()
  .then(() => console.log("\n✓ Processing complete"))
  .catch(err => {
    console.error("\n✗ Error:", err.message);
    process.exit(1);
  });
