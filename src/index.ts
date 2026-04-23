#!/usr/bin/env node
import { Command } from "commander";
import {
  runClearAuthTokenFlow,
  runDownloadFlow,
  runDownloadImagesFlow,
  runExportMetadataJsonFlow,
  runFetchMetadataFlow,
  runImportMetadataJsonFlow,
  runListFlow,
  runMetadataFlow,
  runJobStatusFlow,
  runOrchestratorFlow,
  runProcessFlow,
  runRefreshFlow,
  runSyncFlow,
  runWatchJobFlow,
  runWorkerFlow,
  runWorkspacesFlow,
} from "./cli-actions";
import { DEFAULT_DATABASE_PATH, DEFAULT_DOWNLOAD_ROOT } from "./cli-defaults";

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

function addMetadataDatabaseOptions(command: Command): Command {
  return command
    .option("--database-type <type>", "Metadata database backend: sqlite or postgres", "sqlite")
    .option("--database <path>", "SQLite metadata database path when --database-type is sqlite", DEFAULT_DATABASE_PATH)
    .option("--postgres-url <url>", "Postgres connection URL when --database-type is postgres");
}

function addRuntimeModeOptions(command: Command): Command {
  return command
    .option("--runtime-mode <mode>", "Execution mode: local or distributed", "local")
    .option("--submit-only", "Submit the job without executing it in this process");
}

program
  .command("clear-auth-token")
  .description("Clear the cached Suno authentication token")
  .action(withCliError(runClearAuthTokenFlow));

addMetadataDatabaseOptions(program
  .command("import-metadata-json")
  .description("Import existing songs_metadata.json data into the metadata database")
  .requiredOption("-i, --input <path>", "Current-format metadata JSON file"))
  .action(withCliError(runImportMetadataJsonFlow));

addMetadataDatabaseOptions(program
  .command("export-metadata-json")
  .description("Export metadata database data as current-format JSON")
  .requiredOption("-o, --output <path>", "Output metadata JSON file"))
  .action(withCliError(runExportMetadataJsonFlow));

addRuntimeModeOptions(program
  .command("download")
  .description("Download tracks from Suno")
  .option("-t, --token <token>", "Authentication token")
  .option(
    "-b, --browser [url]",
    "Connect to existing Chrome instance (default: http://localhost:9222)",
  )
  .option("--ignore-cached-token", "Skip cached authentication token and use --token or --browser")
  .option("--browser-profile <dir>", "Chrome user data directory for launched browser")
  .option("--profile-directory <name>", "Chrome profile directory inside --browser-profile")
  .option("-w, --workspace <id>", "Workspace ID (default: all workspaces)")
  .option("-f, --format <format>", "Download format: mp3 or wav", "wav")
  .option("-o, --output <dir>", "Output directory", DEFAULT_DOWNLOAD_ROOT)
  .option("--database-type <type>", "Metadata database backend: sqlite or postgres", "sqlite")
  .option("--database <path>", "SQLite metadata database path when --database-type is sqlite", DEFAULT_DATABASE_PATH)
  .option("--postgres-url <url>", "Postgres connection URL when --database-type is postgres")
  .option("--import-metadata-json <path>", "Import current-format metadata JSON into the database before running")
  .option("--export-metadata-json <path>", "Export metadata database to current-format JSON after running")
  .option("--metadata-file <path>", "Legacy JSON export path used by --copy-songs-metadata-to-output")
  .option("--copy-songs-metadata-to-output", "Export finalized songs_metadata.json to output on completion")
  .option("--no-metadata", "Skip metadata sidecar files")
  .option("--created-after <date>", "Only include tracks created on/after date (ISO or YYYY-MM-DD)")
  .option("--created-before <date>", "Only include tracks created on/before date (ISO or YYYY-MM-DD)")
  .option("--delay <ms>", "Delay between downloads in ms", "1000")
  .option("--flush-cache", "Clear cache before starting"))
  .action(withCliError(runDownloadFlow));

addRuntimeModeOptions(program
  .command("sync")
  .description("Download tracks, then run converter in one chained workflow")
  .option("-t, --token <token>", "Authentication token")
  .option(
    "-b, --browser [url]",
    "Connect to existing Chrome instance (default: http://localhost:9222)",
  )
  .option("--ignore-cached-token", "Skip cached authentication token and use --token or --browser")
  .option("--browser-profile <dir>", "Chrome user data directory for launched browser")
  .option("--profile-directory <name>", "Chrome profile directory inside --browser-profile")
  .option("-w, --workspace <id>", "Workspace ID (default: all workspaces)")
  .option("-f, --format <format>", "Download format: mp3 or wav", "wav")
  .option("-o, --output <dir>", "Download/output directory for source files", DEFAULT_DOWNLOAD_ROOT)
  .option("--database-type <type>", "Metadata database backend: sqlite or postgres", "sqlite")
  .option("--database <path>", "SQLite metadata database path when --database-type is sqlite", DEFAULT_DATABASE_PATH)
  .option("--postgres-url <url>", "Postgres connection URL when --database-type is postgres")
  .option("--import-metadata-json <path>", "Import current-format metadata JSON into the database before running")
  .option("--export-metadata-json <path>", "Export metadata database to current-format JSON after running")
  .option("--metadata-file <path>", "Legacy JSON export path used by --copy-songs-metadata-to-output")
  .option("--copy-songs-metadata-to-output", "Export finalized songs_metadata.json to output on completion")
  .option("--created-after <date>", "Only include tracks created on/after date (ISO or YYYY-MM-DD)")
  .option("--created-before <date>", "Only include tracks created on/before date (ISO or YYYY-MM-DD)")
  .option("--delay <ms>", "Delay between downloads in ms", "1000")
  .option("--flush-cache", "Clear cache before starting")
  .option("--library <dir>", "Final converted library output (default: same as --output)")
  .option("--process-formats <formats>", "Converter formats", "flac,mp3,alac")
  .option("--process-bitrate <kbps>", "Converter MP3 bitrate", "320")
  .option("--process-concurrency <n>", "Converter processing concurrency", "4")
  .option("--process-update-concurrency <n>", "Converter update concurrency", "8")
  .option("--process-existing-metadata", "Re-process all existing metadata after the download phase")
  .option("--no-images", "Skip embedding images during conversion")
  .option("--no-lyrics", "Skip embedding lyrics during conversion")
  .option("--exit-on-error", "Exit immediately on conversion errors"))
  .action(withCliError(runSyncFlow));

addRuntimeModeOptions(program
  .command("process")
  .description("Run audio conversion/metadata embedding (converter functionality)")
  .requiredOption("-i, --input <path>", "Input root directory")
  .requiredOption("-o, --output <path>", "Output root directory")
  .option("--database-type <type>", "Metadata database backend: sqlite or postgres", "sqlite")
  .option("--database <path>", "SQLite metadata database path when --database-type is sqlite", DEFAULT_DATABASE_PATH)
  .option("--postgres-url <url>", "Postgres connection URL when --database-type is postgres")
  .option("--import-metadata-json <path>", "Import current-format metadata JSON into the database before running")
  .option("--export-metadata-json <path>", "Export metadata database to current-format JSON after running")
  .option("--metadata-file <path>", "Legacy JSON export path used by --copy-songs-metadata-to-output")
  .option("--copy-songs-metadata-to-output", "Export finalized songs_metadata.json to output on completion")
  .option("--process-formats <formats>", "Audio formats", "flac,mp3,alac")
  .option("--process-bitrate <kbps>", "MP3 bitrate", "320")
  .option("--process-concurrency <n>", "Processing concurrency", "4")
  .option("--process-update-concurrency <n>", "Update concurrency", "8")
  .option("--no-images", "Skip embedding images")
  .option("--no-lyrics", "Skip embedding lyrics")
  .option("--exit-on-error", "Exit on processing error")
  .option("--reconvert-before <iso>", "Only reconvert on/before date")
  .option("--reconvert-after <iso>", "Only reconvert on/after date")
  .option("--reconvert-missing", "Only process missing formats"))
  .action(withCliError(runProcessFlow));

addRuntimeModeOptions(program
  .command("download-images")
  .description("Download artwork from a JSON list or auto-discover missing images")
  .option("-l, --list <file>", "JSON file containing clipId/thumbnail objects")
  .option("-t, --token <token>", "Authentication token")
  .option(
    "-b, --browser [url]",
    "Connect to existing Chrome instance (default: http://localhost:9222)",
  )
  .option("--ignore-cached-token", "Skip cached authentication token and use --token or --browser")
  .option("--browser-profile <dir>", "Chrome user data directory for launched browser")
  .option("--profile-directory <name>", "Chrome profile directory inside --browser-profile")
  .option("-o, --output <dir>", "Output directory", DEFAULT_DOWNLOAD_ROOT)
  .option("--database-type <type>", "Metadata database backend: sqlite or postgres", "sqlite")
  .option("--database <path>", "SQLite metadata database path when --database-type is sqlite", DEFAULT_DATABASE_PATH)
  .option("--postgres-url <url>", "Postgres connection URL when --database-type is postgres")
  .option("--import-metadata-json <path>", "Import current-format metadata JSON into the database before running")
  .option("--export-metadata-json <path>", "Export metadata database to current-format JSON after running")
  .option("--metadata-file <path>", "Legacy JSON export path used by --copy-songs-metadata-to-output")
  .option("--copy-songs-metadata-to-output", "Export finalized songs_metadata.json to output on completion")
  .option("--fetch-image-list <file>", "Find missing images and write list to JSON file")
  .option("--fetch-missing", "Find missing images and download them directly")
  .option("--delay <ms>", "Delay between downloads in ms", "1000"))
  .action(withCliError(runDownloadImagesFlow));

program
  .command("list")
  .description("List all tracks")
  .option("-t, --token <token>", "Authentication token")
  .option(
    "-b, --browser [url]",
    "Connect to existing Chrome instance (default: http://localhost:9222)",
  )
  .option("--ignore-cached-token", "Skip cached authentication token and use --token or --browser")
  .option("--browser-profile <dir>", "Chrome user data directory for launched browser")
  .option("--profile-directory <name>", "Chrome profile directory inside --browser-profile")
  .option("--database-type <type>", "Metadata database backend: sqlite or postgres", "sqlite")
  .option("--database <path>", "SQLite metadata database path when --database-type is sqlite", DEFAULT_DATABASE_PATH)
  .option("--postgres-url <url>", "Postgres connection URL when --database-type is postgres")
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
  .option("--ignore-cached-token", "Skip cached authentication token and use --token or --browser")
  .option("--browser-profile <dir>", "Chrome user data directory for launched browser")
  .option("--profile-directory <name>", "Chrome profile directory inside --browser-profile")
  .option("--database-type <type>", "Metadata database backend: sqlite or postgres", "sqlite")
  .option("--database <path>", "SQLite metadata database path when --database-type is sqlite", DEFAULT_DATABASE_PATH)
  .option("--postgres-url <url>", "Postgres connection URL when --database-type is postgres")
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
  .option("--ignore-cached-token", "Skip cached authentication token and use --token or --browser")
  .option("--browser-profile <dir>", "Chrome user data directory for launched browser")
  .option("--profile-directory <name>", "Chrome profile directory inside --browser-profile")
  .action(withCliError(runMetadataFlow));

addRuntimeModeOptions(program
  .command("fetch-metadata")
  .description("Fetch and cache metadata for all tracks")
  .option("-t, --token <token>", "Authentication token")
  .option(
    "-b, --browser [url]",
    "Connect to existing Chrome instance (default: http://localhost:9222)",
  )
  .option("--ignore-cached-token", "Skip cached authentication token and use --token or --browser")
  .option("--browser-profile <dir>", "Chrome user data directory for launched browser")
  .option("--profile-directory <name>", "Chrome profile directory inside --browser-profile")
  .option("--ids <ids>", "Comma-separated list of track IDs to fetch")
  .option("--database-type <type>", "Metadata database backend: sqlite or postgres", "sqlite")
  .option("--database <path>", "SQLite metadata database path when --database-type is sqlite", DEFAULT_DATABASE_PATH)
  .option("--postgres-url <url>", "Postgres connection URL when --database-type is postgres")
  .option("-w, --workspace <id>", "Workspace ID (default: all workspaces)")
  .option("--created-after <date>", "Only include tracks created on/after date (ISO or YYYY-MM-DD)")
  .option("--created-before <date>", "Only include tracks created on/before date (ISO or YYYY-MM-DD)"))
  .action(withCliError(runFetchMetadataFlow));

addRuntimeModeOptions(program
  .command("refresh")
  .description("Refresh cached tracks for all workspaces")
  .option("-t, --token <token>", "Authentication token")
  .option(
    "-b, --browser [url]",
    "Connect to existing Chrome instance (default: http://localhost:9222)",
  )
  .option("--ignore-cached-token", "Skip cached authentication token and use --token or --browser")
  .option("--browser-profile <dir>", "Chrome user data directory for launched browser")
  .option("--profile-directory <name>", "Chrome profile directory inside --browser-profile")
  .option("--database-type <type>", "Metadata database backend: sqlite or postgres", "sqlite")
  .option("--database <path>", "SQLite metadata database path when --database-type is sqlite", DEFAULT_DATABASE_PATH)
  .option("--postgres-url <url>", "Postgres connection URL when --database-type is postgres"))
  .action(withCliError(runRefreshFlow));

program
  .command("run-orchestrator")
  .description("Run the local control-plane orchestrator loop")
  .option("--once", "Process at most one polling cycle and exit")
  .option("--poll-interval <ms>", "Polling interval in ms", "500")
  .action(withCliError(runOrchestratorFlow));

program
  .command("run-worker")
  .description("Run a worker loop for a specific role")
  .requiredOption("--role <role>", "Worker role: auth, metadata, asset, processing, or conversion")
  .option("--once", "Process at most one work item and exit")
  .option("--poll-interval <ms>", "Polling interval in ms", "500")
  .action(withCliError(runWorkerFlow));

program
  .command("job-status <jobId>")
  .description("Show local orchestrator job status")
  .option("--json", "Output job status as JSON")
  .action(withCliError(runJobStatusFlow));

program
  .command("watch-job <jobId>")
  .description("Watch local orchestrator job status until completion")
  .option("--json", "Output job status as JSON on each refresh")
  .option("--interval <ms>", "Polling interval in ms", "1000")
  .action(withCliError(runWatchJobFlow));

program.parse();
