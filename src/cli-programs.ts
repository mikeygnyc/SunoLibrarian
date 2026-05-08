import { Command } from "commander";
import {
  normalizeApiServerConfig,
  normalizeLibrarianConfig,
  normalizeOperatorCliConfig,
  normalizeOrchestratorConfig,
  normalizeSupervisorConfig,
  normalizeWorkerConfig,
} from "./app-config";
import {
  runApiCancelJobFlow,
  runApiHealthFlow,
  runApiJobStatusFlow,
  runApiLogsFlow,
  runApiSubmitWorkflowFlow,
  runApiWatchJobFlow,
  runCaptureAuthTokenFlow,
  runClearAuthTokenFlow,
  runDownloadFlow,
  runDownloadImagesFlow,
  runExportMetadataJsonFlow,
  runFetchMetadataFlow,
  runImportMetadataJsonFlow,
  runLibrarianFlow,
  runListFlow,
  runLogsFlow,
  runMetadataFlow,
  runJobStatusFlow,
  runOrchestratorFlow,
  runProcessFlow,
  runRefreshFlow,
  runSyncFlow,
  runSupervisorFlow,
  runWatchJobFlow,
  runWorkerFlow,
  runWorkspacesFlow,
} from "./cli-actions";
import { DEFAULT_DATABASE_PATH, DEFAULT_DOWNLOAD_ROOT } from "./cli-defaults";
import { runServeApiFlow } from "./http-api";

export function createLegacyProgram(): Command {
  const program = createBaseProgram(
    "suno-export",
    "CLI tool to export Suno tracks",
  );

  registerOperatorCliCommands(program);
  registerLibrarianCommand(program);
  registerOrchestratorCommand(program);
  registerWorkerCommand(program);
  registerSupervisorCommand(program);
  registerServeApiCommand(program);

  return program;
}

export function createOperatorCliProgram(): Command {
  const program = createBaseProgram(
    "suno-export-operator",
    "Operator CLI for Suno export workflows and control-plane actions",
  );

  registerOperatorCliCommands(program);
  return program;
}

export function createApiProgram(): Command {
  return createAppRuntimeProgram(
    "suno-export-api",
    "HTTP API server for Suno export control-plane operations",
    async (options) => runServeApiFlow(normalizeApiServerConfig(options)),
    (program) => program
      .option("--host <host>", "Host interface to bind", "127.0.0.1")
      .option("--port <port>", "Port to listen on", "3000")
      .option("--control-plane <backend>", "Control-plane backend: local or postgres", "local")
      .option("--control-plane-dir <path>", "Local control-plane state directory")
      .option("--postgres-url <url>", "Postgres control-plane connection URL")
      .option("--database-type <type>", "Workflow metadata database backend: sqlite or postgres")
      .option("--database <path>", "Workflow SQLite metadata database path when --database-type is sqlite")
      .option("--output <dir>", "Server-owned download/workspace root for API-submitted workflows", DEFAULT_DOWNLOAD_ROOT)
      .option("--library <dir>", "Server-owned library output root for API-submitted process/sync workflows")
      .option("--log-file <path>", "Local HTTP API log file path", "data/http-api.log"),
  );
}

export function createOrchestratorProgram(): Command {
  return createAppRuntimeProgram(
    "suno-export-orchestrator",
    "Orchestrator runtime for Suno export distributed workflows",
    async (options) => runOrchestratorFlow(normalizeOrchestratorConfig(options)),
    (program) => program
      .option("--control-plane <backend>", "Control-plane backend: local or postgres", "local")
      .option("--control-plane-dir <path>", "Local control-plane state directory")
      .option("--postgres-url <url>", "Postgres control-plane connection URL")
      .option("--health-host <host>", "Host interface for orchestrator health endpoint")
      .option("--health-port <port>", "Port for orchestrator health endpoint")
      .option("--once", "Process at most one polling cycle and exit")
      .option("--poll-interval <ms>", "Polling interval in ms", "500"),
  );
}

export function createWorkerProgram(): Command {
  return createAppRuntimeProgram(
    "suno-export-worker",
    "Worker runtime for a single Suno export worker role",
    async (options) => runWorkerFlow(normalizeWorkerConfig(options)),
    (program) => program
      .requiredOption("--role <role>", "Worker role: auth, metadata, asset, processing, or conversion")
      .option("--control-plane <backend>", "Control-plane backend: local or postgres", "local")
      .option("--control-plane-dir <path>", "Local control-plane state directory")
      .option("--postgres-url <url>", "Postgres control-plane connection URL")
      .option("--health-host <host>", "Host interface for worker health endpoint")
      .option("--health-port <port>", "Port for worker health endpoint")
      .option("--once", "Process at most one work item and exit")
      .option("--poll-interval <ms>", "Polling interval in ms", "500"),
  );
}

export function createLibrarianProgram(): Command {
  return createAppRuntimeProgram(
    "suno-export-librarian",
    "Workspace-scoped librarian runtime for Suno metadata synchronization",
    async (options) => runLibrarianFlow(normalizeLibrarianConfig(options)),
    (program) => addMetadataDatabaseOptions(program)
      .option("-t, --token <token>", "Authentication token")
      .option(
        "-b, --browser [url]",
        "Connect to existing Chrome instance (default: http://localhost:9222)",
      )
      .option("--ignore-cached-token", "Skip cached authentication token and use --token or --browser")
      .option("--browser-profile <dir>", "Chrome user data directory for launched browser")
      .option("--profile-directory <name>", "Chrome profile directory inside --browser-profile")
      .requiredOption("-w, --workspace <id>", "Pinned workspace ID for librarian sync")
      .option("--enabled-workspaces <ids>", "Comma-separated workspace allowlist for librarian traffic")
      .option("--disabled-workspaces <ids>", "Comma-separated workspace denylist for librarian traffic")
      .option("--health-host <host>", "Host interface for librarian health endpoint")
      .option("--health-port <port>", "Port for librarian health endpoint")
      .option("--librarian-interval <ms>", "Delay between workspace sync cycles in ms", "300000")
      .option("--once", "Sync the configured workspace and exit"),
  );
}

export function createSupervisorProgram(): Command {
  return createAppRuntimeProgram(
    "suno-export-supervisor",
    "Supervisor runtime for managed local Suno export child processes",
    async (options) => runSupervisorFlow(normalizeSupervisorConfig(options)),
    (program) => program
      .option("--mode <mode>", "Supervisor mode: local or remote", "local")
      .option("--control-plane <backend>", "Control-plane backend: local or postgres", "local")
      .option("--control-plane-dir <path>", "Local control-plane state directory")
      .option("--postgres-url <url>", "Postgres control-plane connection URL")
      .option("-t, --token <token>", "Authentication token used for workspace discovery and librarian children")
      .option(
        "-b, --browser [url]",
        "Connect to existing Chrome instance for workspace discovery (default: http://localhost:9222)",
      )
      .option("--ignore-cached-token", "Skip cached authentication token and use --token or --browser")
      .option("--browser-profile <dir>", "Chrome user data directory for launched browser")
      .option("--profile-directory <name>", "Chrome profile directory inside --browser-profile")
      .option("--database-type <type>", "Metadata database backend for supervised librarian children", "sqlite")
      .option("--database <path>", "SQLite metadata database path when --database-type is sqlite")
      .option("--api-host <host>", "Host interface for the supervised API child", "127.0.0.1")
      .option("--api-port <port>", "Port for the supervised API child", "3000")
      .option("--health-host <host>", "Host interface for supervised child health endpoints", "127.0.0.1")
      .option("--orchestrator-health-port <port>", "Health port for the supervised orchestrator child", "3101")
      .option(
        "--worker-topology <spec>",
        "Comma-separated worker topology as role=count entries",
        "auth=1,asset=1,processing=1,conversion=1",
      )
      .option("--worker-roles <roles>", "Comma-separated worker roles to supervise", "auth")
      .option("--worker-health-port-base <port>", "Base health port for supervised workers", "3200")
      .option("--librarian-interval <ms>", "Delay between librarian sync cycles in ms", "300000")
      .option("--librarian-health-port-base <port>", "Base health port for supervised librarian children", "3300")
      .option("--workspace-refresh-interval-ms <ms>", "Workspace discovery and policy refresh interval in ms", "60000")
      .option("--excluded-workspaces <ids>", "Comma-separated workspace IDs excluded from initial librarian creation")
      .option("--workspace-policy-file <path>", "JSON file with runtime workspace policy such as disabledWorkspaceIds")
      .option("--startup-timeout-ms <ms>", "Maximum readiness wait per child in ms", "15000"),
  );
}

function createBaseProgram(name: string, description: string): Command {
  return new Command()
    .name(name)
    .description(description)
    .version("1.0.0");
}

function createAppRuntimeProgram(
  name: string,
  description: string,
  handler: (options: Record<string, unknown>) => Promise<void>,
  configure: (program: Command) => Command,
): Command {
  const program = createBaseProgram(name, description);
  addCacheDirOption(program);
  configure(program);
  program.action(withCliError(handler));
  return program;
}

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

function withOperatorCliConfig<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => Promise<TResult>,
) {
  return async (...args: TArgs): Promise<void> => {
    const lastArg = args[args.length - 1];
    if (lastArg && typeof lastArg === "object") {
      normalizeOperatorCliConfig(lastArg as Record<string, unknown>);
    }
    await withCliError(handler)(...args);
  };
}

function addMetadataDatabaseOptions(command: Command): Command {
  return command
    .option("--cache-dir <path>", "Local cache root directory")
    .option("--database-type <type>", "Metadata database backend: sqlite or postgres", "sqlite")
    .option("--database <path>", "SQLite metadata database path when --database-type is sqlite", DEFAULT_DATABASE_PATH)
    .option("--postgres-url <url>", "Postgres connection URL when --database-type is postgres");
}

function addRuntimeModeOptions(command: Command): Command {
  return command
    .option("--runtime-mode <mode>", "Execution mode: local or distributed", "local")
    .option("--control-plane <backend>", "Control-plane backend: local or postgres", "local")
    .option("--control-plane-dir <path>", "Local control-plane state directory")
    .option("--submit-only", "Submit the job without executing it in this process");
}

function addControlPlaneOptions(command: Command): Command {
  return command
    .option("--control-plane <backend>", "Control-plane backend: local or postgres", "local")
    .option("--control-plane-dir <path>", "Local control-plane state directory")
    .option("--postgres-url <url>", "Postgres control-plane connection URL");
}

function addApiUrlOption(command: Command): Command {
  return command
    .option("--cache-dir <path>", "Local cache root directory")
    .option("--api-url <url>", "HTTP API base URL", "http://127.0.0.1:3000");
}

function addCacheDirOption(command: Command): Command {
  return command
    .option("--cache-dir <path>", "Local cache root directory");
}

function registerOperatorCliCommands(program: Command): void {
  addCacheDirOption(program
    .command("capture-auth-token")
    .description("Capture a fresh Suno auth token locally for pasting into the dashboard or API")
    .option(
      "-b, --browser [url]",
      "Connect to existing Chrome instance (default: http://localhost:9222)",
    )
    .option("--browser-profile <dir>", "Chrome user data directory for launched browser")
    .option("--profile-directory <name>", "Chrome profile directory inside --browser-profile")
    .option("--save-local", "Save the captured token to the local cache after printing it")
    .option("--json", "Output the captured token as JSON"))
    .action(withOperatorCliConfig(runCaptureAuthTokenFlow));

  addCacheDirOption(program
    .command("clear-auth-token")
    .description("Clear the cached Suno authentication token"))
    .action(withOperatorCliConfig(runClearAuthTokenFlow));

  addMetadataDatabaseOptions(program
    .command("import-metadata-json")
    .description("Import existing songs_metadata.json data into the metadata database")
    .requiredOption("-i, --input <path>", "Current-format metadata JSON file"))
    .action(withOperatorCliConfig(runImportMetadataJsonFlow));

  addMetadataDatabaseOptions(program
    .command("export-metadata-json")
    .description("Export metadata database data as current-format JSON")
    .requiredOption("-o, --output <path>", "Output metadata JSON file"))
    .action(withOperatorCliConfig(runExportMetadataJsonFlow));

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
    .action(withOperatorCliConfig(runDownloadFlow));

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
    .option("--process-concurrency <n>", "Legacy compatibility flag for processing worker concurrency", "4")
    .option("--process-update-concurrency <n>", "Legacy compatibility flag for conversion/update concurrency", "8")
    .option("--process-existing-metadata", "Re-process all existing metadata after the download phase")
    .option("--no-images", "Skip embedding images during conversion")
    .option("--no-lyrics", "Skip embedding lyrics during conversion")
    .option("--exit-on-error", "Exit immediately on conversion errors"))
    .action(withOperatorCliConfig(runSyncFlow));

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
    .option("--process-concurrency <n>", "Legacy compatibility flag for processing worker concurrency", "4")
    .option("--process-update-concurrency <n>", "Legacy compatibility flag for conversion/update concurrency", "8")
    .option("--no-images", "Skip embedding images")
    .option("--no-lyrics", "Skip embedding lyrics")
    .option("--exit-on-error", "Exit on processing error")
    .option("--reconvert-before <iso>", "Only reconvert on/before date")
    .option("--reconvert-after <iso>", "Only reconvert on/after date")
    .option("--reconvert-missing", "Only process missing formats"))
    .action(withOperatorCliConfig(runProcessFlow));

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
    .action(withOperatorCliConfig(runDownloadImagesFlow));

  addCacheDirOption(program
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
    .option("--json", "Output as JSON"))
    .action(withOperatorCliConfig(runListFlow));

  addCacheDirOption(program
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
    .option("--json", "Output as JSON"))
    .action(withOperatorCliConfig(runWorkspacesFlow));

  addCacheDirOption(program
    .command("metadata <trackId>")
    .description("Fetch metadata for a specific track")
    .option("-t, --token <token>", "Authentication token")
    .option(
      "-b, --browser [url]",
      "Connect to existing Chrome instance (default: http://localhost:9222)",
    )
    .option("--ignore-cached-token", "Skip cached authentication token and use --token or --browser")
    .option("--browser-profile <dir>", "Chrome user data directory for launched browser")
    .option("--profile-directory <name>", "Chrome profile directory inside --browser-profile"))
    .action(withOperatorCliConfig(runMetadataFlow));

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
    .action(withOperatorCliConfig(runFetchMetadataFlow));

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
    .action(withOperatorCliConfig(runRefreshFlow));

  addControlPlaneOptions(program
    .command("job-status <jobId>")
    .description("Show local orchestrator job status")
    .option("--json", "Output job status as JSON"))
    .action(withOperatorCliConfig(runJobStatusFlow));

  addControlPlaneOptions(program
    .command("watch-job <jobId>")
    .description("Watch local orchestrator job status until completion")
    .option("--json", "Output job status as JSON on each refresh")
    .option("--interval <ms>", "Polling interval in ms", "1000"))
    .action(withOperatorCliConfig(runWatchJobFlow));

  addControlPlaneOptions(program
    .command("logs")
    .description("Query centralized orchestration logs")
    .option("--job-id <jobId>", "Filter by job id")
    .option("--stage-id <stageId>", "Filter by stage id")
    .option("--work-item-id <workItemId>", "Filter by work item id")
    .option("--workflow-type <workflow>", "Filter by workflow type")
    .option("--worker-instance-id <workerInstanceId>", "Filter by worker instance id")
    .option("--role <role>", "Filter by worker role")
    .option("--clip-id <clipId>", "Filter by clip id")
    .option("--level <level>", "Filter by log level")
    .option("--start-time <iso>", "Only include logs on/after ISO timestamp")
    .option("--end-time <iso>", "Only include logs on/before ISO timestamp")
    .option("--limit <n>", "Maximum logs to return", "100")
    .option("--json", "Output logs as JSON"))
    .action(withOperatorCliConfig(runLogsFlow));

  addApiUrlOption(program
    .command("api-health")
    .description("Check HTTP API health")
    .option("--json", "Output response as JSON"))
    .action(withOperatorCliConfig(runApiHealthFlow));

  addApiUrlOption(program
    .command("api-submit <workflow>")
    .description("Submit a workflow using a validated JSON payload")
    .requiredOption("--payload <path>", "JSON payload file path, or - to read from stdin")
    .option("--json", "Output response as JSON"))
    .action(withOperatorCliConfig(runApiSubmitWorkflowFlow));

  addApiUrlOption(program
    .command("api-job-status <jobId>")
    .description("Show HTTP API job status")
    .option("--json", "Output job status as JSON"))
    .action(withOperatorCliConfig(runApiJobStatusFlow));

  addApiUrlOption(program
    .command("api-watch-job <jobId>")
    .description("Watch HTTP API job status until completion")
    .option("--json", "Output job status as JSON on each refresh")
    .option("--interval <ms>", "Polling interval in ms", "1000"))
    .action(withOperatorCliConfig(runApiWatchJobFlow));

  addApiUrlOption(program
    .command("api-cancel-job <jobId>")
    .description("Cancel a queued or running job through the HTTP API")
    .option("--reason <text>", "Optional cancellation reason")
    .option("--json", "Output response as JSON"))
    .action(withOperatorCliConfig(runApiCancelJobFlow));

  addApiUrlOption(program
    .command("api-logs")
    .description("Query logs through the HTTP API")
    .option("--job-id <jobId>", "Filter by job id")
    .option("--stage-id <stageId>", "Filter by stage id")
    .option("--work-item-id <workItemId>", "Filter by work item id")
    .option("--workflow-type <workflow>", "Filter by workflow type")
    .option("--worker-instance-id <workerInstanceId>", "Filter by worker instance id")
    .option("--role <role>", "Filter by worker role")
    .option("--clip-id <clipId>", "Filter by clip id")
    .option("--level <level>", "Filter by log level")
    .option("--start-time <iso>", "Only include logs on/after ISO timestamp")
    .option("--end-time <iso>", "Only include logs on/before ISO timestamp")
    .option("--limit <n>", "Maximum logs to return", "100")
    .option("--json", "Output logs as JSON"))
    .action(withOperatorCliConfig(runApiLogsFlow));
}

function registerLibrarianCommand(program: Command): void {
  addMetadataDatabaseOptions(program
    .command("run-librarian")
    .description("Run the background metadata librarian loop")
    .option("-t, --token <token>", "Authentication token")
    .option(
      "-b, --browser [url]",
      "Connect to existing Chrome instance (default: http://localhost:9222)",
    )
    .option("--ignore-cached-token", "Skip cached authentication token and use --token or --browser")
    .option("--browser-profile <dir>", "Chrome user data directory for launched browser")
    .option("--profile-directory <name>", "Chrome profile directory inside --browser-profile")
    .requiredOption("-w, --workspace <id>", "Pinned workspace ID for librarian sync")
    .option("--enabled-workspaces <ids>", "Comma-separated workspace allowlist for librarian traffic")
    .option("--disabled-workspaces <ids>", "Comma-separated workspace denylist for librarian traffic")
    .option("--librarian-interval <ms>", "Delay between workspace sync cycles in ms", "300000")
    .option("--once", "Sync the configured workspace and exit"))
    .action(withCliError(async (options) => runLibrarianFlow(normalizeLibrarianConfig(options))));
}

function registerOrchestratorCommand(program: Command): void {
  addControlPlaneOptions(program
    .command("run-orchestrator")
    .description("Run the local control-plane orchestrator loop")
    .option("--once", "Process at most one polling cycle and exit")
    .option("--poll-interval <ms>", "Polling interval in ms", "500"))
    .action(withCliError(async (options) => runOrchestratorFlow(normalizeOrchestratorConfig(options))));
}

function registerWorkerCommand(program: Command): void {
  addControlPlaneOptions(program
    .command("run-worker")
    .description("Run a worker loop for a specific role")
    .requiredOption("--role <role>", "Worker role: auth, metadata, asset, processing, or conversion")
    .option("--once", "Process at most one work item and exit")
    .option("--poll-interval <ms>", "Polling interval in ms", "500"))
    .action(withCliError(async (options) => runWorkerFlow(normalizeWorkerConfig(options))));
}

function registerServeApiCommand(program: Command): void {
  program
    .command("serve-api")
    .description("Run the HTTP API server")
    .option("--host <host>", "Host interface to bind", "127.0.0.1")
    .option("--port <port>", "Port to listen on", "3000")
    .option("--control-plane <backend>", "Control-plane backend: local or postgres", "local")
    .option("--control-plane-dir <path>", "Local control-plane state directory")
    .option("--postgres-url <url>", "Postgres control-plane connection URL")
    .option("--database-type <type>", "Workflow metadata database backend: sqlite or postgres")
    .option("--database <path>", "Workflow SQLite metadata database path when --database-type is sqlite")
    .option("--output <dir>", "Server-owned download/workspace root for API-submitted workflows", DEFAULT_DOWNLOAD_ROOT)
    .option("--library <dir>", "Server-owned library output root for API-submitted process/sync workflows")
    .option("--log-file <path>", "Local HTTP API log file path", "data/http-api.log")
    .action(withCliError(async (options) => runServeApiFlow(normalizeApiServerConfig(options))));
}

function registerSupervisorCommand(program: Command): void {
  addCacheDirOption(program
    .command("run-supervisor")
    .description("Run the local supervisor for managed runtime child processes")
    .option("--mode <mode>", "Supervisor mode: local or remote", "local")
    .option("--control-plane <backend>", "Control-plane backend: local or postgres", "local")
    .option("--control-plane-dir <path>", "Local control-plane state directory")
    .option("--postgres-url <url>", "Postgres control-plane connection URL")
    .option("-t, --token <token>", "Authentication token used for workspace discovery and librarian children")
    .option(
      "-b, --browser [url]",
      "Connect to existing Chrome instance for workspace discovery (default: http://localhost:9222)",
    )
    .option("--ignore-cached-token", "Skip cached authentication token and use --token or --browser")
    .option("--browser-profile <dir>", "Chrome user data directory for launched browser")
    .option("--profile-directory <name>", "Chrome profile directory inside --browser-profile")
    .option("--database-type <type>", "Metadata database backend for supervised librarian children", "sqlite")
    .option("--database <path>", "SQLite metadata database path when --database-type is sqlite")
    .option("--api-host <host>", "Host interface for the supervised API child", "127.0.0.1")
    .option("--api-port <port>", "Port for the supervised API child", "3000")
    .option("--health-host <host>", "Host interface for supervised child health endpoints", "127.0.0.1")
    .option("--orchestrator-health-port <port>", "Health port for the supervised orchestrator child", "3101")
    .option(
      "--worker-topology <spec>",
      "Comma-separated worker topology as role=count entries",
      "auth=1,asset=1,processing=1,conversion=1",
    )
    .option("--worker-roles <roles>", "Comma-separated worker roles to supervise", "auth")
    .option("--worker-health-port-base <port>", "Base health port for supervised workers", "3200")
    .option("--librarian-interval <ms>", "Delay between librarian sync cycles in ms", "300000")
    .option("--librarian-health-port-base <port>", "Base health port for supervised librarian children", "3300")
    .option("--workspace-refresh-interval-ms <ms>", "Workspace discovery and policy refresh interval in ms", "60000")
    .option("--excluded-workspaces <ids>", "Comma-separated workspace IDs excluded from initial librarian creation")
    .option("--workspace-policy-file <path>", "JSON file with runtime workspace policy such as disabledWorkspaceIds")
    .option("--startup-timeout-ms <ms>", "Maximum readiness wait per child in ms", "15000"))
    .action(withCliError(async (options) => runSupervisorFlow(normalizeSupervisorConfig(options))));
}
