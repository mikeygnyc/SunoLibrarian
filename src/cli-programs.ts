import { Command, Option } from "commander";
import {
  normalizeApiServerConfig,
  normalizeLibrarianConfig,
  normalizeOperatorCliConfig,
  normalizeWorkerConfig,
} from "./app-config";
import {
  runApiCancelJobFlow,
  runApiHealthFlow,
  runApiSubmitWorkflowFlow,
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
  runProcessFlow,
  runRefreshFlow,
  runSyncFlow,
  runWatchJobFlow,
  runWorkerFlow,
  runWorkspacesFlow,
} from "./cli-actions";
import { DEFAULT_DATABASE_PATH, DEFAULT_DOWNLOAD_ROOT } from "./cli-defaults";
import { runServeApiFlow } from "./http-api";

export function createCliProgram(): Command {
  const program = createBaseProgram(
    "suno-export",
    "CLI tool to export Suno tracks",
  );

  registerOperatorCliCommands(program);
  registerLibrarianCommand(program);
  registerWorkerCommand(program);
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
      .requiredOption("--postgres-url <url>", "Postgres control-plane connection URL")
      .option("--database-type <type>", "Workflow metadata database backend: sqlite or postgres")
      .option("--database <path>", "Workflow SQLite metadata database path when --database-type is sqlite")
      .option("--output <dir>", "Server-owned download/workspace root for API-submitted workflows", DEFAULT_DOWNLOAD_ROOT)
      .option("--library <dir>", "Server-owned library output root for API-submitted process/sync workflows")
      .option("--log-file <path>", "Local HTTP API log file path", "data/http-api.log"),
  );
}

export function createWorkerProgram(): Command {
  return createAppRuntimeProgram(
    "suno-export-worker",
    "Runtime/internal worker process for a single Suno export worker role",
    async (options) => runWorkerFlow(normalizeWorkerConfig(options)),
    (program) => program
      .requiredOption("--role <role>", "Worker role: auth, metadata, asset, processing, or conversion")
      .requiredOption("--postgres-url <url>", "Postgres control-plane connection URL")
      .option("--health-host <host>", "Host interface for worker health endpoint")
      .option("--health-port <port>", "Port for worker health endpoint")
      .option("--once", "Process at most one work item and exit")
      .option("--poll-interval <ms>", "Polling interval in ms", "500"),
  );
}

export function createLibrarianProgram(): Command {
  return createAppRuntimeProgram(
    "suno-export-librarian",
    "Runtime/internal librarian process for workspace-scoped metadata synchronization",
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

function addPostgresControlPlaneOptions(command: Command): Command {
  return command
    .requiredOption("--postgres-url <url>", "Postgres control-plane connection URL");
}

function addApiUrlOption(command: Command): Command {
  return command
    .option("--cache-dir <path>", "Local cache root directory")
    .option("--api-url <url>", "HTTP API base URL override");
}

function addWorkflowConfigOption(command: Command): Command {
  return command
    .option("--config <path>", "Workflow target config file");
}

function addApiTargetOptions(command: Command): Command {
  return addWorkflowConfigOption(addApiUrlOption(command));
}

function addCacheDirOption(command: Command): Command {
  return command
    .option("--cache-dir <path>", "Local cache root directory");
}

function addHiddenOption(
  command: Command,
  flags: string,
  description: string,
  defaultValue?: string,
): Command {
  const option = new Option(flags, description).hideHelp();
  if (defaultValue !== undefined) {
    option.default(defaultValue);
  }
  command.addOption(option);
  return command;
}

function addHiddenAuthOptions(command: Command): Command {
  addHiddenOption(command, "-t, --token <token>", "Authentication token");
  addHiddenOption(
    command,
    "-b, --browser [url]",
    "Connect to existing Chrome instance (default: http://localhost:9222)",
  );
  addHiddenOption(command, "--ignore-cached-token", "Skip cached authentication token and use --token or --browser");
  addHiddenOption(command, "--browser-profile <dir>", "Chrome user data directory for launched browser");
  addHiddenOption(command, "--profile-directory <name>", "Chrome profile directory inside --browser-profile");
  return command;
}

function addHiddenMetadataStoreOptions(command: Command): Command {
  addHiddenOption(command, "--cache-dir <path>", "Local cache root directory");
  addHiddenOption(command, "--database-type <type>", "Metadata database backend: sqlite or postgres", "sqlite");
  addHiddenOption(
    command,
    "--database <path>",
    "SQLite metadata database path when --database-type is sqlite",
    DEFAULT_DATABASE_PATH,
  );
  addHiddenOption(command, "--postgres-url <url>", "Postgres connection URL when --database-type is postgres");
  return command;
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

  addWorkflowConfigOption(addMetadataDatabaseOptions(program
    .command("import-metadata-json")
    .description("Import existing songs_metadata.json data into the selected metadata store")
    .requiredOption("-i, --input <path>", "Current-format metadata JSON file")))
    .action(withOperatorCliConfig(runImportMetadataJsonFlow));

  addWorkflowConfigOption(addMetadataDatabaseOptions(program
    .command("export-metadata-json")
    .description("Export selected metadata store data as current-format JSON")
    .requiredOption("-o, --output <path>", "Output metadata JSON file")))
    .action(withOperatorCliConfig(runExportMetadataJsonFlow));

  const downloadCommand = addWorkflowConfigOption(addHiddenAuthOptions(program
    .command("download")
    .description("Download tracks from Suno")
    .option("--api-url <url>", "HTTP API base URL override")
    .option("-w, --workspace <id>", "Workspace ID (default: all workspaces)")
    .option("-f, --format <format>", "Download format: mp3 or wav", "wav")
    .option("-o, --output <dir>", "Output directory override for local target")
    .option("--created-after <date>", "Only include tracks created on/after date (ISO or YYYY-MM-DD)")
    .option("--created-before <date>", "Only include tracks created on/before date (ISO or YYYY-MM-DD)")
  ));
  addHiddenOption(downloadCommand, "--delay <ms>", "Delay between downloads in ms", "1000");
  addHiddenOption(downloadCommand, "--flush-cache", "Clear cache before starting");
  downloadCommand.action(withOperatorCliConfig(runDownloadFlow));

  const syncCommand = addWorkflowConfigOption(addHiddenAuthOptions(program
    .command("sync")
    .description("Download tracks, then run converter in one chained workflow")
    .option("--api-url <url>", "HTTP API base URL override")
    .option("-w, --workspace <id>", "Workspace ID (default: all workspaces)")
    .option("-f, --format <format>", "Download format: mp3 or wav", "wav")
    .option("-o, --output <dir>", "Download/output directory override for local target")
    .option("--created-after <date>", "Only include tracks created on/after date (ISO or YYYY-MM-DD)")
    .option("--created-before <date>", "Only include tracks created on/before date (ISO or YYYY-MM-DD)")
    .option("--library <dir>", "Final converted library output override for local target")
  ));
  addHiddenOption(syncCommand, "--delay <ms>", "Delay between downloads in ms", "1000");
  addHiddenOption(syncCommand, "--flush-cache", "Clear cache before starting");
  addHiddenOption(syncCommand, "--process-formats <formats>", "Converter formats", "flac,mp3,alac");
  addHiddenOption(syncCommand, "--process-bitrate <kbps>", "Converter MP3 bitrate", "320");
  syncCommand.action(withOperatorCliConfig(runSyncFlow));

  const processCommand = addWorkflowConfigOption(program
    .command("process")
    .description("Run audio conversion/metadata embedding (converter functionality)")
    .option("--api-url <url>", "HTTP API base URL override")
    .option("-i, --input <path>", "Input root directory override for local target")
    .option("-o, --output <path>", "Output root directory override for local target"),
  );
  addHiddenOption(processCommand, "--process-formats <formats>", "Audio formats", "flac,mp3,alac");
  addHiddenOption(processCommand, "--process-bitrate <kbps>", "MP3 bitrate", "320");
  addHiddenOption(processCommand, "--reconvert-before <iso>", "Only reconvert on/before date");
  addHiddenOption(processCommand, "--reconvert-after <iso>", "Only reconvert on/after date");
  addHiddenOption(processCommand, "--reconvert-missing", "Only process missing formats");
  processCommand.action(withOperatorCliConfig(runProcessFlow));

  addApiTargetOptions(program
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
    .option("--fetch-image-list <file>", "Find missing images and write list to JSON file")
    .option("--fetch-missing", "Find missing images and download them directly"))
    .action(withOperatorCliConfig(runDownloadImagesFlow));

  addWorkflowConfigOption(addCacheDirOption(program
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
    .option("-w, --workspace <id>", "Workspace ID (default: all workspaces)")
    .option("--json", "Output as JSON")))
    .action(withOperatorCliConfig(runListFlow));

  addWorkflowConfigOption(addCacheDirOption(program
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
    .option("--json", "Output as JSON")))
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

  addApiTargetOptions(program
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
    .option("-w, --workspace <id>", "Workspace ID (default: all workspaces)")
    .option("--created-after <date>", "Only include tracks created on/after date (ISO or YYYY-MM-DD)")
    .option("--created-before <date>", "Only include tracks created on/before date (ISO or YYYY-MM-DD)"))
    .action(withOperatorCliConfig(runFetchMetadataFlow));

  addApiTargetOptions(program
    .command("refresh")
    .description("Refresh cached tracks for all workspaces")
    .option("-t, --token <token>", "Authentication token")
    .option(
      "-b, --browser [url]",
      "Connect to existing Chrome instance (default: http://localhost:9222)",
    )
    .option("--ignore-cached-token", "Skip cached authentication token and use --token or --browser")
    .option("--browser-profile <dir>", "Chrome user data directory for launched browser")
    .option("--profile-directory <name>", "Chrome profile directory inside --browser-profile"))
    .action(withOperatorCliConfig(runRefreshFlow));

  addApiTargetOptions(program
    .command("job-status <jobId>")
    .description("Show workflow job status")
    .option("--json", "Output job status as JSON"))
    .action(withOperatorCliConfig(runJobStatusFlow));

  addApiTargetOptions(program
    .command("watch-job <jobId>")
    .description("Watch workflow job status until completion")
    .option("--json", "Output job status as JSON on each refresh")
    .option("--interval <ms>", "Polling interval in ms", "1000"))
    .action(withOperatorCliConfig(runWatchJobFlow));

  addApiTargetOptions(program
    .command("logs")
    .description("Query workflow logs")
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

  addApiTargetOptions(program
    .command("api-health")
    .description("Check HTTP API health")
    .option("--json", "Output response as JSON"))
    .action(withOperatorCliConfig(runApiHealthFlow));

  addApiTargetOptions(program
    .command("api-submit <workflow>")
    .description("Submit a workflow using a validated JSON payload")
    .requiredOption("--payload <path>", "JSON payload file path, or - to read from stdin")
    .option("--json", "Output response as JSON"))
    .action(withOperatorCliConfig(runApiSubmitWorkflowFlow));

  addApiTargetOptions(program
    .command("api-cancel-job <jobId>")
    .description("Cancel a queued or running job through the HTTP API")
    .option("--reason <text>", "Optional cancellation reason")
    .option("--json", "Output response as JSON"))
    .action(withOperatorCliConfig(runApiCancelJobFlow));
}

function registerLibrarianCommand(program: Command): void {
  addMetadataDatabaseOptions(program
    .command("run-librarian")
    .description("Run the runtime/internal librarian loop")
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

function registerWorkerCommand(program: Command): void {
  addPostgresControlPlaneOptions(program
    .command("run-worker")
    .description("Run the runtime/internal worker loop for a specific role")
    .requiredOption("--role <role>", "Worker role: auth, metadata, asset, processing, or conversion")
    .option("--once", "Process at most one work item and exit")
    .option("--poll-interval <ms>", "Polling interval in ms", "500"))
    .action(withCliError(async (options) => runWorkerFlow(normalizeWorkerConfig(options))));
}

function registerServeApiCommand(program: Command): void {
  program
    .command("serve-api")
    .description("Run the HTTP API server and orchestration entrypoint")
    .option("--host <host>", "Host interface to bind", "127.0.0.1")
    .option("--port <port>", "Port to listen on", "3000")
    .requiredOption("--postgres-url <url>", "Postgres control-plane connection URL")
    .option("--database-type <type>", "Workflow metadata database backend: sqlite or postgres")
    .option("--database <path>", "Workflow SQLite metadata database path when --database-type is sqlite")
    .option("--output <dir>", "Server-owned download/workspace root for API-submitted workflows", DEFAULT_DOWNLOAD_ROOT)
    .option("--library <dir>", "Server-owned library output root for API-submitted process/sync workflows")
    .option("--log-file <path>", "Local HTTP API log file path", "data/http-api.log")
    .action(withCliError(async (options) => runServeApiFlow(normalizeApiServerConfig(options))));
}
