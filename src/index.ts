#!/usr/bin/env node
import { Command } from "commander";
import {
  runDownloadFlow,
  runDownloadImagesFlow,
  runFetchMetadataFlow,
  runListFlow,
  runMetadataFlow,
  runProcessFlow,
  runRefreshFlow,
  runSyncFlow,
  runWorkspacesFlow,
} from "./cli-actions";
import { DEFAULT_DOWNLOAD_ROOT } from "./cli-defaults";

const program = new Command();

program
  .name("suno-export")
  .description("CLI tool to export Suno tracks")
  .version("1.0.0");

function withCliError<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => Promise<TResult>,
) {
  return async (...args: TArgs): Promise<void> => {
    try {
      await handler(...args);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  };
}

program
  .command("download")
  .description("Download tracks from Suno")
  .option("-t, --token <token>", "Authentication token")
  .option(
    "-b, --browser [url]",
    "Connect to existing Chrome instance (default: http://localhost:9222)",
  )
  .option("--browser-profile <dir>", "Chrome user data directory for launched browser")
  .option("--profile-directory <name>", "Chrome profile directory inside --browser-profile")
  .option("-w, --workspace <id>", "Workspace ID (default: all workspaces)")
  .option("-f, --format <format>", "Download format: mp3 or wav", "wav")
  .option("-o, --output <dir>", "Output directory", DEFAULT_DOWNLOAD_ROOT)
  .option("--metadata-file <path>", "Metadata JSON file path (default: <output>/songs_metadata.json)")
  .option("--copy-songs-metadata-to-output", "Copy finalized songs_metadata.json to output on completion")
  .option("--no-metadata", "Skip metadata sidecar files")
  .option("--created-after <date>", "Only include tracks created on/after date (ISO or YYYY-MM-DD)")
  .option("--created-before <date>", "Only include tracks created on/before date (ISO or YYYY-MM-DD)")
  .option("--delay <ms>", "Delay between downloads in ms", "1000")
  .option("--flush-cache", "Clear cache before starting")
  .action(withCliError(runDownloadFlow));

program
  .command("sync")
  .description("Download tracks, then run converter in one chained workflow")
  .option("-t, --token <token>", "Authentication token")
  .option(
    "-b, --browser [url]",
    "Connect to existing Chrome instance (default: http://localhost:9222)",
  )
  .option("--browser-profile <dir>", "Chrome user data directory for launched browser")
  .option("--profile-directory <name>", "Chrome profile directory inside --browser-profile")
  .option("-w, --workspace <id>", "Workspace ID (default: all workspaces)")
  .option("-f, --format <format>", "Download format: mp3 or wav", "wav")
  .option("-o, --output <dir>", "Download/output directory for source files", DEFAULT_DOWNLOAD_ROOT)
  .option("--metadata-file <path>", "Metadata JSON file path (default: <output>/songs_metadata.json)")
  .option("--copy-songs-metadata-to-output", "Copy finalized songs_metadata.json to output on completion")
  .option("--created-after <date>", "Only include tracks created on/after date (ISO or YYYY-MM-DD)")
  .option("--created-before <date>", "Only include tracks created on/before date (ISO or YYYY-MM-DD)")
  .option("--delay <ms>", "Delay between downloads in ms", "1000")
  .option("--flush-cache", "Clear cache before starting")
  .option("--library <dir>", "Final converted library output (default: same as --output)")
  .option("--process-formats <formats>", "Converter formats", "flac,mp3,alac")
  .option("--process-bitrate <kbps>", "Converter MP3 bitrate", "320")
  .option("--process-concurrency <n>", "Converter processing concurrency", "4")
  .option("--process-update-concurrency <n>", "Converter update concurrency", "8")
  .option("--no-images", "Skip embedding images during conversion")
  .option("--no-lyrics", "Skip embedding lyrics during conversion")
  .option("--exit-on-error", "Exit immediately on conversion errors")
  .action(withCliError(runSyncFlow));

program
  .command("process")
  .description("Run audio conversion/metadata embedding (converter functionality)")
  .requiredOption("-i, --input <path>", "Input root directory")
  .requiredOption("-o, --output <path>", "Output root directory")
  .option("--metadata-file <path>", "Metadata JSON file path (default: <input>/songs_metadata.json)")
  .option("--copy-songs-metadata-to-output", "Copy finalized songs_metadata.json to output on completion")
  .option("--process-formats <formats>", "Audio formats", "flac,mp3,alac")
  .option("--process-bitrate <kbps>", "MP3 bitrate", "320")
  .option("--process-concurrency <n>", "Processing concurrency", "4")
  .option("--process-update-concurrency <n>", "Update concurrency", "8")
  .option("--no-images", "Skip embedding images")
  .option("--no-lyrics", "Skip embedding lyrics")
  .option("--exit-on-error", "Exit on processing error")
  .option("--reconvert-before <iso>", "Only reconvert on/before date")
  .option("--reconvert-after <iso>", "Only reconvert on/after date")
  .option("--reconvert-missing", "Only process missing formats")
  .action(withCliError(runProcessFlow));

program
  .command("download-images")
  .description("Download artwork from a JSON list or auto-discover missing images")
  .option("-l, --list <file>", "JSON file containing clipId/thumbnail objects")
  .option("-t, --token <token>", "Authentication token")
  .option(
    "-b, --browser [url]",
    "Connect to existing Chrome instance (default: http://localhost:9222)",
  )
  .option("--browser-profile <dir>", "Chrome user data directory for launched browser")
  .option("--profile-directory <name>", "Chrome profile directory inside --browser-profile")
  .option("-o, --output <dir>", "Output directory", DEFAULT_DOWNLOAD_ROOT)
  .option("--metadata-file <path>", "Metadata JSON file path (default: <output>/songs_metadata.json)")
  .option("--copy-songs-metadata-to-output", "Copy finalized songs_metadata.json to output on completion")
  .option("--fetch-image-list <file>", "Find missing images and write list to JSON file")
  .option("--fetch-missing", "Find missing images and download them directly")
  .option("--delay <ms>", "Delay between downloads in ms", "1000")
  .action(withCliError(runDownloadImagesFlow));

program
  .command("list")
  .description("List all tracks")
  .option("-t, --token <token>", "Authentication token")
  .option(
    "-b, --browser [url]",
    "Connect to existing Chrome instance (default: http://localhost:9222)",
  )
  .option("--browser-profile <dir>", "Chrome user data directory for launched browser")
  .option("--profile-directory <name>", "Chrome profile directory inside --browser-profile")
  .option("-w, --workspace <id>", "Workspace ID (default: all workspaces)")
  .option("--json", "Output as JSON")
  .action(withCliError(runListFlow));

program
  .command("workspaces")
  .description("List all workspaces")
  .option("-t, --token <token>", "Authentication token")
  .option(
    "-b, --browser [url]",
    "Connect to existing Chrome instance (default: http://localhost:9222)",
  )
  .option("--browser-profile <dir>", "Chrome user data directory for launched browser")
  .option("--profile-directory <name>", "Chrome profile directory inside --browser-profile")
  .option("--json", "Output as JSON")
  .action(withCliError(runWorkspacesFlow));

program
  .command("metadata <trackId>")
  .description("Fetch metadata for a specific track")
  .option("-t, --token <token>", "Authentication token")
  .option(
    "-b, --browser [url]",
    "Connect to existing Chrome instance (default: http://localhost:9222)",
  )
  .option("--browser-profile <dir>", "Chrome user data directory for launched browser")
  .option("--profile-directory <name>", "Chrome profile directory inside --browser-profile")
  .action(withCliError(runMetadataFlow));

program
  .command("fetch-metadata")
  .description("Fetch and cache metadata for all tracks")
  .option("-t, --token <token>", "Authentication token")
  .option(
    "-b, --browser [url]",
    "Connect to existing Chrome instance (default: http://localhost:9222)",
  )
  .option("--browser-profile <dir>", "Chrome user data directory for launched browser")
  .option("--profile-directory <name>", "Chrome profile directory inside --browser-profile")
  .option("--ids <ids>", "Comma-separated list of track IDs to fetch")
  .option("-w, --workspace <id>", "Workspace ID (default: all workspaces)")
  .option("--created-after <date>", "Only include tracks created on/after date (ISO or YYYY-MM-DD)")
  .option("--created-before <date>", "Only include tracks created on/before date (ISO or YYYY-MM-DD)")
  .action(withCliError(runFetchMetadataFlow));

program
  .command("refresh")
  .description("Refresh cached tracks for all workspaces")
  .option("-t, --token <token>", "Authentication token")
  .option(
    "-b, --browser [url]",
    "Connect to existing Chrome instance (default: http://localhost:9222)",
  )
  .option("--browser-profile <dir>", "Chrome user data directory for launched browser")
  .option("--profile-directory <name>", "Chrome profile directory inside --browser-profile")
  .action(withCliError(runRefreshFlow));

program.parse();
