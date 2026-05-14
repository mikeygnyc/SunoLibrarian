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
import { DEFAULT_DOWNLOAD_ROOT } from "./cli-defaults";
import { resolveCliCommandOptions } from "./cli-config";
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
      .option("--postgres-url <url>", "Postgres control-plane connection URL")
      .option("--mqtt-url <url>", "MQTT broker URL for control-plane messaging")
      .option("--mqtt-topic-prefix <prefix>", "MQTT topic prefix for control-plane messaging")
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
      .option("--role <role>", "Worker role: auth, metadata, asset, or conversion")
      .option("--postgres-url <url>", "Postgres control-plane connection URL")
      .option("--mqtt-url <url>", "MQTT broker URL for control-plane messaging")
      .option("--mqtt-topic-prefix <prefix>", "MQTT topic prefix for control-plane messaging")
      .option("--health-host <host>", "Host interface for worker health endpoint")
      .option("--health-port <port>", "Port for worker health endpoint")
      .option("--once", "Process at most one work item and exit")
      .option("--poll-interval <ms>", "Deprecated compatibility flag; MQTT-dispatched workers do not poll", "500"),
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
      .option("-w, --workspace <id>", "Pinned workspace ID for librarian sync")
      .option("--enabled-workspaces <ids>", "Comma-separated workspace allowlist for librarian traffic")
      .option("--disabled-workspaces <ids>", "Comma-separated workspace denylist for librarian traffic")
      .option("--health-host <host>", "Host interface for librarian health endpoint")
      .option("--health-port <port>", "Port for librarian health endpoint")
      .option("--librarian-interval <ms>", "Delay between workspace sync cycles in ms", "21600000")
      .option("--mqtt-url <url>", "MQTT broker URL for control-plane messaging")
      .option("--mqtt-topic-prefix <prefix>", "MQTT topic prefix for control-plane messaging")
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
  program.action(withResolvedCommandOptions(name, handler));
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

function withResolvedCommandOptions<TArgs extends unknown[], TResult>(
  commandName: string,
  handler: (...args: TArgs) => Promise<TResult>,
  normalizeOptions?: (options: Record<string, unknown>) => Record<string, unknown>,
) {
  return async (...args: TArgs): Promise<void> => {
    const resolvedArgs = injectResolvedOptions(commandName, args, normalizeOptions);
    await withCliError(handler)(...(resolvedArgs as TArgs));
  };
}

function injectResolvedOptions<TArgs extends unknown[]>(
  commandName: string,
  args: TArgs,
  normalizeOptions?: (options: Record<string, unknown>) => Record<string, unknown>,
): unknown[] {
  const nextArgs = [...args];
  const lastArg = nextArgs[nextArgs.length - 1];
  const command = lastArg instanceof Command ? lastArg : undefined;
  const rawOptions = command
    ? command.optsWithGlobals()
    : findOptionsObject(nextArgs) ?? {};
  const resolvedOptions = resolveCliCommandOptions(commandName, rawOptions, command);
  const normalizedOptions = normalizeOptions
    ? normalizeOptions(resolvedOptions)
    : resolvedOptions;

  if (command) {
    const optionsIndex = findOptionsIndexBeforeCommand(nextArgs);
    if (optionsIndex >= 0) {
      nextArgs[optionsIndex] = normalizedOptions;
      return nextArgs;
    }
    nextArgs.splice(nextArgs.length - 1, 0, normalizedOptions);
    return nextArgs;
  }

  const optionsIndex = findOptionsIndex(nextArgs);
  if (optionsIndex >= 0) {
    nextArgs[optionsIndex] = normalizedOptions;
    return nextArgs;
  }

  nextArgs.push(normalizedOptions);
  return nextArgs;
}

function findOptionsObject(args: unknown[]): Record<string, unknown> | undefined {
  const optionsIndex = findOptionsIndex(args);
  return optionsIndex >= 0 ? args[optionsIndex] as Record<string, unknown> : undefined;
}

function findOptionsIndex(args: unknown[]): number {
  for (let index = args.length - 1; index >= 0; index -= 1) {
    const value = args[index];
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Command)) {
      return index;
    }
  }
  return -1;
}

function findOptionsIndexBeforeCommand(args: unknown[]): number {
  if (args.length < 2) {
    return -1;
  }
  const candidate = args[args.length - 2];
  return candidate && typeof candidate === "object" && !Array.isArray(candidate) && !(candidate instanceof Command)
    ? args.length - 2
    : -1;
}

function addMetadataDatabaseOptions(command: Command): Command {
  return addConfigOption(command)
    .option("--cache-dir <path>", "Local cache root directory")
    .option("--database-type <type>", "Metadata database backend: sqlite or postgres")
    .option("--database <path>", "SQLite metadata database path when --database-type is sqlite")
    .option("--postgres-url <url>", "Postgres connection URL when --database-type is postgres");
}

function addPostgresControlPlaneOptions(command: Command): Command {
  return addConfigOption(command)
    .option("--postgres-url <url>", "Postgres control-plane connection URL")
    .option("--mqtt-url <url>", "MQTT broker URL for control-plane messaging")
    .option("--mqtt-topic-prefix <prefix>", "MQTT topic prefix for control-plane messaging");
}

function addApiUrlOption(command: Command): Command {
  return addConfigOption(command)
    .option("--cache-dir <path>", "Local cache root directory")
    .option("--api-url <url>", "HTTP API base URL override");
}

function addWorkflowConfigOption(command: Command): Command {
  return addConfigOption(command);
}

function addApiTargetOptions(command: Command): Command {
  return addWorkflowConfigOption(addApiUrlOption(command));
}

function addCacheDirOption(command: Command): Command {
  return addConfigOption(command)
    .option("--cache-dir <path>", "Local cache root directory");
}

function addConfigOption(command: Command): Command {
  const hasConfigOption = command.options.some((option) => option.attributeName() === "config");
  if (!hasConfigOption) {
    command.option("--config <path>", "CLI config file");
  }
  return command;
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
  addHiddenOption(command, "--database-type <type>", "Metadata database backend: sqlite or postgres");
  addHiddenOption(
    command,
    "--database <path>",
    "SQLite metadata database path when --database-type is sqlite",
  );
  addHiddenOption(command, "--postgres-url <url>", "Postgres connection URL when --database-type is postgres");
  return command;
}

function registerOperatorCliCommands(program: Command): void {
  addApiUrlOption(program
    .command("capture-auth-token")
    .description("Capture a fresh Suno auth token locally for pasting into the dashboard or API")
    .option(
      "-b, --browser [url]",
      "Connect to existing Chrome instance (default: http://localhost:9222)",
    )
    .option("--browser-profile <dir>", "Chrome user data directory for launched browser")
    .option("--profile-directory <name>", "Chrome profile directory inside --browser-profile")
    .option("--save-local", "Save the captured token to the local cache after printing it")
    .option("--send-to-api", "Post the captured token to the configured HTTP API after saving it locally")
    .option("--json", "Output the captured token as JSON"))
    .action(withResolvedCommandOptions("capture-auth-token", runCaptureAuthTokenFlow, normalizeOperatorCliConfig));

  addCacheDirOption(program
    .command("clear-auth-token")
    .description("Clear the cached Suno authentication token"))
    .action(withResolvedCommandOptions("clear-auth-token", runClearAuthTokenFlow, normalizeOperatorCliConfig));

  addWorkflowConfigOption(addMetadataDatabaseOptions(program
    .command("import-metadata-json")
    .description("Import existing songs_metadata.json data into the selected metadata store")
    .option("-i, --input <path>", "Current-format metadata JSON file")))
    .action(withResolvedCommandOptions("import-metadata-json", runImportMetadataJsonFlow, normalizeOperatorCliConfig));

  addWorkflowConfigOption(addMetadataDatabaseOptions(program
    .command("export-metadata-json")
    .description("Export selected metadata store data as current-format JSON")
    .option("-o, --output <path>", "Output metadata JSON file")))
    .action(withResolvedCommandOptions("export-metadata-json", runExportMetadataJsonFlow, normalizeOperatorCliConfig));

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
  downloadCommand.action(withResolvedCommandOptions("download", runDownloadFlow, normalizeOperatorCliConfig));

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
  syncCommand.action(withResolvedCommandOptions("sync", runSyncFlow, normalizeOperatorCliConfig));

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
  processCommand.action(withResolvedCommandOptions("process", runProcessFlow, normalizeOperatorCliConfig));

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
    .action(withResolvedCommandOptions("download-images", runDownloadImagesFlow, normalizeOperatorCliConfig));

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
    .action(withResolvedCommandOptions("list", runListFlow, normalizeOperatorCliConfig));

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
    .action(withResolvedCommandOptions("workspaces", runWorkspacesFlow, normalizeOperatorCliConfig));

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
    .action(withResolvedCommandOptions("metadata", runMetadataFlow, normalizeOperatorCliConfig));

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
    .action(withResolvedCommandOptions("fetch-metadata", runFetchMetadataFlow, normalizeOperatorCliConfig));

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
    .action(withResolvedCommandOptions("refresh", runRefreshFlow, normalizeOperatorCliConfig));

  addApiTargetOptions(program
    .command("job-status <jobId>")
    .description("Show workflow job status")
    .option("--json", "Output job status as JSON"))
    .action(withResolvedCommandOptions("job-status", runJobStatusFlow, normalizeOperatorCliConfig));

  addApiTargetOptions(program
    .command("watch-job <jobId>")
    .description("Watch workflow job status until completion")
    .option("--json", "Output job status as JSON on each refresh")
    .option("--interval <ms>", "Polling interval in ms", "1000"))
    .action(withResolvedCommandOptions("watch-job", runWatchJobFlow, normalizeOperatorCliConfig));

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
    .action(withResolvedCommandOptions("logs", runLogsFlow, normalizeOperatorCliConfig));

  addApiTargetOptions(program
    .command("api-health")
    .description("Check HTTP API health")
    .option("--json", "Output response as JSON"))
    .action(withResolvedCommandOptions("api-health", runApiHealthFlow, normalizeOperatorCliConfig));

  addApiTargetOptions(program
    .command("api-submit <workflow>")
    .description("Submit a workflow using a validated JSON payload")
    .option("--payload <path>", "JSON payload file path, or - to read from stdin")
    .option("--json", "Output response as JSON"))
    .action(withResolvedCommandOptions("api-submit", runApiSubmitWorkflowFlow, normalizeOperatorCliConfig));

  addApiTargetOptions(program
    .command("api-cancel-job <jobId>")
    .description("Cancel a queued or running job through the HTTP API")
    .option("--reason <text>", "Optional cancellation reason")
    .option("--json", "Output response as JSON"))
    .action(withResolvedCommandOptions("api-cancel-job", runApiCancelJobFlow, normalizeOperatorCliConfig));
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
    .option("-w, --workspace <id>", "Pinned workspace ID for librarian sync")
    .option("--enabled-workspaces <ids>", "Comma-separated workspace allowlist for librarian traffic")
    .option("--disabled-workspaces <ids>", "Comma-separated workspace denylist for librarian traffic")
    .option("--librarian-interval <ms>", "Delay between workspace sync cycles in ms", "21600000")
    .option("--mqtt-url <url>", "MQTT broker URL for control-plane messaging")
    .option("--mqtt-topic-prefix <prefix>", "MQTT topic prefix for control-plane messaging")
    .option("--once", "Sync the configured workspace and exit"))
    .action(withResolvedCommandOptions("run-librarian", async (options) => runLibrarianFlow(normalizeLibrarianConfig(options))));
}

function registerWorkerCommand(program: Command): void {
  addPostgresControlPlaneOptions(program
    .command("run-worker")
    .description("Run the runtime/internal worker loop for a specific role")
    .option("--role <role>", "Worker role: auth, metadata, asset, or conversion")
    .option("--once", "Process at most one work item and exit")
    .option("--poll-interval <ms>", "Deprecated compatibility flag; MQTT-dispatched workers do not poll", "500"))
    .action(withResolvedCommandOptions("run-worker", async (options) => runWorkerFlow(normalizeWorkerConfig(options))));
}

function registerServeApiCommand(program: Command): void {
  program
    .command("serve-api")
    .description("Run the HTTP API server and orchestration entrypoint")
    .option("--config <path>", "CLI config file")
    .option("--host <host>", "Host interface to bind", "127.0.0.1")
    .option("--port <port>", "Port to listen on", "3000")
    .option("--postgres-url <url>", "Postgres control-plane connection URL")
    .option("--mqtt-url <url>", "MQTT broker URL for control-plane messaging")
    .option("--mqtt-topic-prefix <prefix>", "MQTT topic prefix for control-plane messaging")
    .option("--database-type <type>", "Workflow metadata database backend: sqlite or postgres")
    .option("--database <path>", "Workflow SQLite metadata database path when --database-type is sqlite")
    .option("--output <dir>", "Server-owned download/workspace root for API-submitted workflows", DEFAULT_DOWNLOAD_ROOT)
    .option("--library <dir>", "Server-owned library output root for API-submitted process/sync workflows")
    .option("--log-file <path>", "Local HTTP API log file path", "data/http-api.log")
    .action(withResolvedCommandOptions("serve-api", async (options) => runServeApiFlow(normalizeApiServerConfig(options))));
}
