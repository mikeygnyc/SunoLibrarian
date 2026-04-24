import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { extractTokenFromBrowser } from "./auth";
import { createCancellationMonitor, isCancellationError } from "./cancellation";
import { HttpApiClient } from "./http-api-client";
import type { LibrarianConfig, OrchestratorConfig, WorkerConfig } from "./app-config";
import type { ICentralLogRepository, IClaimedWorkItem, IJobSnapshot, ILogQueryResult, IOrchestrationRepository, WorkflowType } from "./core/contracts";
import { DEFAULT_RUNTIME_CONFIG, LeaseManager, LocalJobOrchestrator, classifyAuthFailure, createControlPlaneRepository, createJobCancellationAssertion, createRuntimeLogger, getJobSnapshot, getWorkflowStagePlan, resolveControlPlaneBackend, serializeJobPayload, submitWorkflowJob, type ControlPlaneRepository, type LocalWorkflowContext, type WorkflowStagePlanItem } from "./core/orchestration";
import type { IWorkspace } from "./lib/interfaces";
import {
  AssetAcquisitionService,
  AuthService,
  configureAssetAcquisitionService,
  configureMetadataAcquisitionService,
  ConversionService,
  filterWorkspaces,
  getAuthenticatedClientWithDeps,
  LibrarianService,
  MetadataAcquisitionService,
  parseTrackIdsOption,
  ProcessingPlannerService,
  type AuthClient,
  type AuthDeps,
  type AuthStorage,
  type CliOptions,
  type DownloadFlowResult,
} from "./services";
import { Storage } from "./storage";
import {
  createMetadataStore,
  describeMetadataStoreConfig,
  exportMetadataDatabaseToJson,
  importMetadataJsonToDatabase,
  MetadataStoreConfig,
  resolveMetadataStoreConfig,
} from "./metadata-store";

const DEFAULT_METADATA_FILENAME = "songs_metadata.json";
const DEFAULT_WATCH_INTERVAL_MS = 1000;
const DEFAULT_WORKER_POLL_INTERVAL_MS = 500;

export { getAuthenticatedClientWithDeps };
export type { AuthClient, AuthDeps, AuthStorage };
export type CaptureAuthTokenDeps = {
  extractTokenFromBrowser: typeof extractTokenFromBrowser;
  storage: Pick<Storage, "setAuthToken">;
  log: Pick<Console, "log">;
};

type DownloadedTrackHook = (params: {
  clipId: string;
  outputDir: string;
}) => void;

function resolveMetadataFilePath(rootDir: string, options: CliOptions): string {
  return typeof options.metadataFile === "string" && options.metadataFile.trim().length > 0
    ? path.resolve(options.metadataFile.trim())
    : path.join(rootDir, DEFAULT_METADATA_FILENAME);
}

function resolveMetadataJsonExportPath(rootDir: string, options: CliOptions): string {
  return typeof options.exportMetadataJson === "string" && options.exportMetadataJson.trim().length > 0
    ? path.resolve(options.exportMetadataJson.trim())
    : resolveMetadataFilePath(rootDir, options);
}

function resolveMetadataStoreOptions(options: CliOptions): MetadataStoreConfig {
  return resolveMetadataStoreConfig({
    databaseType: options.databaseType,
    database: typeof options.database === "string" ? options.database : undefined,
    postgresUrl: typeof options.postgresUrl === "string" ? options.postgresUrl : undefined,
  });
}

const authService = new AuthService();
const metadataAcquisitionService = new MetadataAcquisitionService();
const assetAcquisitionService = new AssetAcquisitionService();
const processingPlannerService = new ProcessingPlannerService();
const conversionService = new ConversionService();
const librarianService = new LibrarianService(authService, metadataAcquisitionService);

configureMetadataAcquisitionService({
  resolveMetadataStoreOptions,
});

configureAssetAcquisitionService({
  resolveMetadataStoreOptions,
  importMetadataJsonIfRequested,
  exportMetadataJsonIfRequested,
  resolveMetadataJsonExportPath,
});

function logMetadataImportStatus(message: string): void {
  console.log(`[metadata-import] ${message}`);
}

async function importMetadataJsonIfRequested(options: CliOptions, storeConfig: MetadataStoreConfig): Promise<void> {
  if (typeof options.importMetadataJson !== "string" || options.importMetadataJson.trim().length === 0) {
    return;
  }
  logMetadataImportStatus(`Starting import from ${path.resolve(options.importMetadataJson)}`);
  logMetadataImportStatus(`Target database: ${describeMetadataStoreConfig(storeConfig)}`);
  const result = await importMetadataJsonToDatabase(options.importMetadataJson, storeConfig, {
    log: logMetadataImportStatus,
  });
  console.log(`Imported ${result.imported} metadata entr${result.imported === 1 ? "y" : "ies"} to ${result.databasePath}`);
}

async function exportMetadataJsonIfRequested(
  options: CliOptions,
  storeConfig: MetadataStoreConfig,
  fallbackJsonPath: string,
): Promise<void> {
  const shouldExport = typeof options.exportMetadataJson === "string" && options.exportMetadataJson.trim().length > 0;
  if (!shouldExport && !shouldCopySongsMetadataToOutput(options)) return;

  const jsonPath = shouldExport
    ? path.resolve(options.exportMetadataJson.trim())
    : fallbackJsonPath;
  const result = await exportMetadataDatabaseToJson(jsonPath, storeConfig, {
    log: logMetadataImportStatus,
  });
  console.log(`Exported ${result.exported} metadata entr${result.exported === 1 ? "y" : "ies"} to ${result.jsonFilePath}`);
}

function shouldCopySongsMetadataToOutput(options: CliOptions): boolean {
  return options.copySongsMetadataToOutput === true;
}

function shouldSubmitOnly(options: CliOptions): boolean {
  return options.runtimeMode === "distributed" || options.submitOnly === true;
}

async function runDownloadWorkflow(options: CliOptions): Promise<DownloadFlowResult> {
  const client = await authService.getAuthenticatedClient(options);
  return assetAcquisitionService.downloadTracks(
    {
      ...options,
      __storage: new Storage(),
    },
    client,
  );
}

async function runProcessWorkflow(options: CliOptions): Promise<void> {
  const outputDir = path.resolve(String(options.output));
  const storeConfig = resolveMetadataStoreOptions(options);
  await importMetadataJsonIfRequested(options, storeConfig);
  await conversionService.run(
    processingPlannerService.createConverterRunOptions(
      {
        ...options,
        output: outputDir,
      },
      storeConfig,
      { output: outputDir },
    ),
  );
  await exportMetadataJsonIfRequested(
    { ...options, copySongsMetadataToOutput: false },
    storeConfig,
    resolveMetadataJsonExportPath(outputDir, options),
  );
}

export async function runClearAuthTokenFlow(): Promise<void> {
  const storage = new Storage();
  storage.clearAuthToken();
  console.log("Cached authentication token cleared.");
}

export async function captureAuthTokenWithDeps(
  options: CliOptions,
  deps: CaptureAuthTokenDeps,
): Promise<string> {
  const browserUrl = resolveBrowserEndpoint(options);
  if (!browserUrl) {
    throw new Error("Browser authentication is required: provide --browser [url] to capture a token");
  }

  const token = await deps.extractTokenFromBrowser(browserUrl, {
    userDataDir: resolveBrowserUserDataDir(options),
    profileDirectory: resolveBrowserProfileDirectory(options),
    abortSignal: options.__abortSignal,
  });

  if (options.saveLocal === true) {
    deps.storage.setAuthToken(token);
    deps.log.log("Saved captured token to the local cache.");
  }

  if (options.json === true) {
    deps.log.log(JSON.stringify({ token }, null, 2));
  } else {
    deps.log.log("Captured token:");
    deps.log.log(token);
  }

  return token;
}

export async function runCaptureAuthTokenFlow(options: CliOptions = {}): Promise<void> {
  await captureAuthTokenWithDeps(options, {
    extractTokenFromBrowser,
    storage: new Storage(),
    log: console,
  });
}

export async function runImportMetadataJsonFlow(options: CliOptions): Promise<void> {
  const storeConfig = resolveMetadataStoreOptions(options);
  logMetadataImportStatus(`Starting import from ${path.resolve(String(options.input))}`);
  logMetadataImportStatus(`Target database: ${describeMetadataStoreConfig(storeConfig)}`);
  const result = await importMetadataJsonToDatabase(String(options.input), storeConfig, {
    log: logMetadataImportStatus,
  });
  console.log(`Imported ${result.imported} metadata entr${result.imported === 1 ? "y" : "ies"} to ${result.databasePath}`);
}

export async function runExportMetadataJsonFlow(options: CliOptions): Promise<void> {
  const storeConfig = resolveMetadataStoreOptions(options);
  logMetadataImportStatus(`Starting export to ${path.resolve(String(options.output))}`);
  logMetadataImportStatus(`Source database: ${describeMetadataStoreConfig(storeConfig)}`);
  const result = await exportMetadataDatabaseToJson(String(options.output), storeConfig, {
    log: logMetadataImportStatus,
  });
  console.log(`Exported ${result.exported} metadata entr${result.exported === 1 ? "y" : "ies"} to ${result.jsonFilePath}`);
}

async function runSyncWorkflow(options: CliOptions): Promise<void> {
  const outputDir = path.resolve(String(options.output));
  const conversionOutput = options.library || outputDir;
  const storeConfig = resolveMetadataStoreOptions(options);
  const metadataJsonPath = resolveMetadataJsonExportPath(outputDir, options);
  const processExistingMetadata = options.processExistingMetadata === true;
  const downloadedClipIds = new Set<string>();
  let conversionChain: Promise<void> = Promise.resolve();
  let queuedConversions = 0;
  let conversionFailed: Error | null = null;

  const queueConversion = (): void => {
    queuedConversions++;
    conversionChain = conversionChain.then(async () => {
      if (conversionFailed) return;
      await runProcessWorkflow({
        input: outputDir,
        output: conversionOutput,
        databaseType: storeConfig.type,
        database: storeConfig.sqlitePath,
        postgresUrl: storeConfig.postgresUrl,
        copySongsMetadataToOutput: false,
        processFormats: options.processFormats,
        processBitrate: options.processBitrate,
        processConcurrency: options.processConcurrency,
        processUpdateConcurrency: options.processUpdateConcurrency,
        images: options.images,
        lyrics: options.lyrics,
        exitOnError: options.exitOnError,
        processClipIds: processExistingMetadata ? undefined : Array.from(downloadedClipIds),
      });
    }).catch((err: any) => {
      const wrapped = err instanceof Error ? err : new Error(String(err));
      conversionFailed = wrapped;
      if (!options.exitOnError) {
        console.error(`Conversion run failed during sync: ${wrapped.message}`);
      }
    });
  };

  await runDownloadWorkflow({
    ...options,
    output: outputDir,
    databaseType: storeConfig.type,
    database: storeConfig.sqlitePath,
    postgresUrl: storeConfig.postgresUrl,
    exportMetadataJson: undefined,
    copySongsMetadataToOutput: false,
    onTrackDownloaded: ({ clipId }: { clipId: string }) => {
      downloadedClipIds.add(clipId);
      if (!processExistingMetadata) {
        queueConversion();
      }
    },
  });

  if (processExistingMetadata) {
    queueConversion();
  }

  await conversionChain;
  if (conversionFailed) {
    throw conversionFailed;
  }
  await exportMetadataJsonIfRequested(options, storeConfig, metadataJsonPath);
}

async function runDownloadImagesWorkflow(options: CliOptions): Promise<void> {
  const client = await authService.getAuthenticatedClient(options);
  await assetAcquisitionService.downloadImages(options, client);
}

export async function runListFlow(options: CliOptions): Promise<void> {
  const client = await authService.getAuthenticatedClient(options);
  const workspaces = await client.getWorkspaces();
  await metadataAcquisitionService.saveWorkspacesToDatabase(options, workspaces);
  const targetWorkspaces = filterWorkspaces(workspaces, options.workspace);

  if (options.json) {
    const result: Record<string, any> = {};
    for (const workspace of targetWorkspaces) {
      const tracks = await client.getTracks(workspace.id);
      await metadataAcquisitionService.saveTrackWorkspaceLinks(
        options,
        workspace,
        tracks.map((track) => track.id),
      );
      result[workspace.name] = tracks;
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  for (const workspace of targetWorkspaces) {
    console.log(`\n=== ${workspace.name} ===`);
    const tracks = await client.getTracks(workspace.id);
    await metadataAcquisitionService.saveTrackWorkspaceLinks(
      options,
      workspace,
      tracks.map((track) => track.id),
    );
    tracks.forEach((track) => {
      console.log(`  ${track.id} - ${track.title || "(Untitled)"} [${track.status}]`);
    });
  }
}

export async function runWorkspacesFlow(options: CliOptions): Promise<void> {
  const client = await authService.getAuthenticatedClient(options);
  const workspaces = await client.getWorkspaces();
  await metadataAcquisitionService.saveWorkspacesToDatabase(options, workspaces);

  if (options.json) {
    console.log(JSON.stringify(workspaces, null, 2));
    return;
  }

  console.log(`\nFound ${workspaces.length} workspace(s):\n`);
  workspaces.forEach((workspace) => {
    console.log(`  ${workspace.id} - ${workspace.name}`);
  });
}

export async function runMetadataFlow(trackId: string, options: CliOptions): Promise<void> {
  const client = await authService.getAuthenticatedClient(options);
  const metadata = await client.fetchTrackMetadata(trackId);
  console.log(JSON.stringify(metadata, null, 2));
}

async function runFetchMetadataWorkflow(options: CliOptions): Promise<void> {
  const client = await authService.getAuthenticatedClient(options);
  await metadataAcquisitionService.fetchMetadata(options, client);
}

async function runRefreshWorkflow(options: CliOptions): Promise<void> {
  const client = await authService.getAuthenticatedClient(options);
  await metadataAcquisitionService.refresh(options, client);
}

export async function runDownloadFlow(options: CliOptions): Promise<DownloadFlowResult> {
  if (shouldSubmitOnly(options)) {
    const jobId = await submitWorkflowJob("download", options);
    console.log(`Job submitted: ${jobId}`);
      return {
      outputDir: path.resolve(String(options.output)),
      downloaded: 0,
      skipped: 0,
    };
  }

  const { result } = await runLocalWorkflowCommand("download", options, [
    { type: "authorization", workerRole: "auth" },
    { type: "asset-acquisition", workerRole: "asset" },
    { type: "finalization", workerRole: "orchestrator" },
  ], async ({ runStage }) => {
    const client = await runStage("authorization", async () => authService.getAuthenticatedClient(options));
    const downloadResult = await runStage("asset-acquisition", async () => {
      return runDownloadWorkflow({ ...options, __authenticatedClient: client });
    });
    await runStage("finalization", async () => undefined);
    return downloadResult;
  });

  return result;
}

export async function runProcessFlow(options: CliOptions): Promise<void> {
  if (shouldSubmitOnly(options)) {
    const jobId = await submitWorkflowJob("process", options);
    console.log(`Job submitted: ${jobId}`);
    return;
  }

  await runLocalWorkflowCommand("process", options, [
    { type: "processing", workerRole: "processing" },
    { type: "conversion", workerRole: "conversion" },
    { type: "finalization", workerRole: "orchestrator" },
  ], async ({ runStage }) => {
    await runStage("processing", async () => undefined);
    await runStage("conversion", async () => runProcessWorkflow(options));
    await runStage("finalization", async () => undefined);
  });
}

export async function runSyncFlow(options: CliOptions): Promise<void> {
  if (shouldSubmitOnly(options)) {
    const jobId = await submitWorkflowJob("sync", options);
    console.log(`Job submitted: ${jobId}`);
    return;
  }

  await runLocalWorkflowCommand("sync", options, [
    { type: "authorization", workerRole: "auth" },
    { type: "asset-acquisition", workerRole: "asset" },
    { type: "processing", workerRole: "processing" },
    { type: "conversion", workerRole: "conversion" },
    { type: "finalization", workerRole: "orchestrator" },
  ], async ({ runStage }) => {
    const client = await runStage("authorization", async () => authService.getAuthenticatedClient(options));
    const outputDir = path.resolve(String(options.output));
    const conversionOutput = options.library || outputDir;
    const storeConfig = resolveMetadataStoreOptions(options);
    const metadataJsonPath = resolveMetadataJsonExportPath(outputDir, options);
    const processExistingMetadata = options.processExistingMetadata === true;
    const downloadedClipIds = new Set<string>();
    let conversionChain: Promise<void> = Promise.resolve();
    let conversionFailed: Error | null = null;

    const queueConversion = (): void => {
      conversionChain = conversionChain.then(async () => {
        if (conversionFailed) return;
        await runProcessWorkflow({
          input: outputDir,
          output: conversionOutput,
          databaseType: storeConfig.type,
          database: storeConfig.sqlitePath,
          postgresUrl: storeConfig.postgresUrl,
          copySongsMetadataToOutput: false,
          processFormats: options.processFormats,
          processBitrate: options.processBitrate,
          processConcurrency: options.processConcurrency,
          processUpdateConcurrency: options.processUpdateConcurrency,
          images: options.images,
          lyrics: options.lyrics,
          exitOnError: options.exitOnError,
          processClipIds: processExistingMetadata ? undefined : Array.from(downloadedClipIds),
        });
      }).catch((err: any) => {
        const wrapped = err instanceof Error ? err : new Error(String(err));
        conversionFailed = wrapped;
        if (!options.exitOnError) {
          console.error(`Conversion run failed during sync: ${wrapped.message}`);
        }
      });
    };

    await runStage("asset-acquisition", async () => {
      await runDownloadWorkflow({
        ...options,
        __authenticatedClient: client,
        output: outputDir,
        databaseType: storeConfig.type,
        database: storeConfig.sqlitePath,
        postgresUrl: storeConfig.postgresUrl,
        exportMetadataJson: undefined,
        copySongsMetadataToOutput: false,
        onTrackDownloaded: ({ clipId }: { clipId: string }) => {
          downloadedClipIds.add(clipId);
          if (!processExistingMetadata) {
            queueConversion();
          }
        },
      });
    });

    await runStage("processing", async () => {
      if (processExistingMetadata) {
        queueConversion();
      }
    });

    await runStage("conversion", async () => {
      await conversionChain;
      if (conversionFailed) {
        throw conversionFailed;
      }
    });

    await runStage("finalization", async () => {
      await exportMetadataJsonIfRequested(options, storeConfig, metadataJsonPath);
    });
  });
}

export async function runDownloadImagesFlow(options: CliOptions): Promise<void> {
  if (shouldSubmitOnly(options)) {
    const jobId = await submitWorkflowJob("download-images", options);
    console.log(`Job submitted: ${jobId}`);
    return;
  }

  await runLocalWorkflowCommand("download-images", options, [
    { type: "authorization", workerRole: "auth" },
    { type: "asset-acquisition", workerRole: "asset" },
    { type: "finalization", workerRole: "orchestrator" },
  ], async ({ runStage }) => {
    const client = await runStage("authorization", async () => authService.getAuthenticatedClient(options));
    await runStage("asset-acquisition", async () => runDownloadImagesWorkflow({ ...options, __authenticatedClient: client }));
    await runStage("finalization", async () => undefined);
  });
}

export async function runFetchMetadataFlow(options: CliOptions): Promise<void> {
  if (shouldSubmitOnly(options)) {
    const jobId = await submitWorkflowJob("fetch-metadata", options);
    console.log(`Job submitted: ${jobId}`);
    return;
  }

  await runLocalWorkflowCommand("fetch-metadata", options, [
    { type: "authorization", workerRole: "auth" },
    { type: "metadata-acquisition", workerRole: "metadata" },
    { type: "finalization", workerRole: "orchestrator" },
  ], async ({ runStage }) => {
    const client = await runStage("authorization", async () => authService.getAuthenticatedClient(options));
    await runStage("metadata-acquisition", async () => runFetchMetadataWorkflow({ ...options, __authenticatedClient: client }));
    await runStage("finalization", async () => undefined);
  });
}

export async function runRefreshFlow(options: CliOptions): Promise<void> {
  if (shouldSubmitOnly(options)) {
    const jobId = await submitWorkflowJob("refresh", options);
    console.log(`Job submitted: ${jobId}`);
    return;
  }

  await runLocalWorkflowCommand("refresh", options, [
    { type: "authorization", workerRole: "auth" },
    { type: "metadata-acquisition", workerRole: "metadata" },
    { type: "finalization", workerRole: "orchestrator" },
  ], async ({ runStage }) => {
    const client = await runStage("authorization", async () => authService.getAuthenticatedClient(options));
    await runStage("metadata-acquisition", async () => runRefreshWorkflow({ ...options, __authenticatedClient: client }));
    await runStage("finalization", async () => undefined);
  });
}

export async function runLibrarianFlow(options: LibrarianConfig): Promise<void> {
  await librarianService.run(options);
}

export async function runJobStatusFlow(jobId: string, options: CliOptions = {}): Promise<void> {
  const repository = createControlPlaneRepository(options);
  try {
    await repository.initialize();
    const snapshot = await getJobSnapshot(repository, jobId);
    if (!snapshot.job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    printJobSnapshot(snapshot, options.json === true);
  } finally {
    await repository.close();
  }
}

export async function runWatchJobFlow(jobId: string, options: CliOptions = {}): Promise<void> {
  const intervalMs = parseInt(String(options.interval ?? DEFAULT_WATCH_INTERVAL_MS), 10);
  while (true) {
    const repository = createControlPlaneRepository(options);
    await repository.initialize();
    const snapshot = await getJobSnapshot(repository, jobId);
    await repository.close();
    if (!snapshot.job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    console.clear();
    await runJobStatusFlow(jobId, options);

    if (["completed", "failed", "cancelled"].includes(snapshot.job.status)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function runLogsFlow(options: CliOptions = {}): Promise<void> {
  const repository = createControlPlaneRepository(options);
  try {
    await repository.initialize();
    const result = await repository.query({
      jobId: typeof options.jobId === "string" ? options.jobId : undefined,
      stageId: typeof options.stageId === "string" ? options.stageId : undefined,
      workItemId: typeof options.workItemId === "string" ? options.workItemId : undefined,
      workflowType: typeof options.workflowType === "string" ? options.workflowType as any : undefined,
      workerInstanceId: typeof options.workerInstanceId === "string" ? options.workerInstanceId : undefined,
      role: typeof options.role === "string" ? options.role as any : undefined,
      clipId: typeof options.clipId === "string" ? options.clipId : undefined,
      level: typeof options.level === "string" ? options.level as any : undefined,
      startTime: parseOptionalDate(options.startTime, "--start-time"),
      endTime: parseOptionalDate(options.endTime, "--end-time"),
      limit: options.limit ? parseInt(String(options.limit), 10) : 100,
    });

    printLogsResult(result, options.json === true);
  } finally {
    await repository.close();
  }
}

export async function runApiHealthFlow(options: CliOptions = {}): Promise<void> {
  const result = await createApiClient(options).getHealth();
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(result.ok ? "API is healthy." : "API is unhealthy.");
}

export async function runApiSubmitWorkflowFlow(workflow: string, options: CliOptions = {}): Promise<void> {
  const workflowType = normalizeWorkflowTypeInput(workflow);
  const payload = await readApiWorkflowPayload(options.payload);
  const result = await createApiClient(options).submitWorkflow(workflowType, payload as any);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Job submitted: ${result.jobId}`);
  console.log(`  Workflow: ${result.workflowType}`);
  console.log(`  Status: ${result.status}`);
}

export async function runApiJobStatusFlow(jobId: string, options: CliOptions = {}): Promise<void> {
  const snapshot = await createApiClient(options).getJob(jobId);
  printJobSnapshot(snapshot, options.json === true);
}

export async function runApiWatchJobFlow(jobId: string, options: CliOptions = {}): Promise<void> {
  const intervalMs = parseInt(String(options.interval ?? DEFAULT_WATCH_INTERVAL_MS), 10);
  while (true) {
    const snapshot = await createApiClient(options).getJob(jobId);
    console.clear();
    printJobSnapshot(snapshot, options.json === true);

    if (snapshot.job && ["completed", "failed", "cancelled"].includes(snapshot.job.status)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function runApiCancelJobFlow(jobId: string, options: CliOptions = {}): Promise<void> {
  const result = await createApiClient(options).cancelJob(
    jobId,
    typeof options.reason === "string" ? options.reason : undefined,
  );

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Job ${result.jobId} cancelled.`);
}

export async function runApiLogsFlow(options: CliOptions = {}): Promise<void> {
  const result = await createApiClient(options).queryLogs({
    jobId: typeof options.jobId === "string" ? options.jobId : undefined,
    stageId: typeof options.stageId === "string" ? options.stageId : undefined,
    workItemId: typeof options.workItemId === "string" ? options.workItemId : undefined,
    workflowType: typeof options.workflowType === "string" ? normalizeWorkflowTypeInput(options.workflowType) : undefined,
    workerInstanceId: typeof options.workerInstanceId === "string" ? options.workerInstanceId : undefined,
    role: typeof options.role === "string" ? options.role as any : undefined,
    clipId: typeof options.clipId === "string" ? options.clipId : undefined,
    level: typeof options.level === "string" ? options.level as any : undefined,
    startTime: parseOptionalDate(options.startTime, "--start-time"),
    endTime: parseOptionalDate(options.endTime, "--end-time"),
    limit: options.limit ? parseInt(String(options.limit), 10) : 100,
  });
  printLogsResult(result, options.json === true);
}

export async function runOrchestratorFlow(options: OrchestratorConfig = {}): Promise<void> {
  const pollIntervalMs = parseInt(String(options.pollInterval ?? DEFAULT_WORKER_POLL_INTERVAL_MS), 10);
  const once = options.once === true;
  const loggerRepository = createControlPlaneRepository(options);
  await loggerRepository.initialize();
  const logger = createRuntimeLogger(loggerRepository);
  const roles: Array<"orchestrator" | "auth" | "metadata" | "asset" | "processing" | "conversion"> = [
    "orchestrator",
    "auth",
    "metadata",
    "asset",
    "processing",
    "conversion",
  ];

  try {
    do {
      let processed = 0;
      for (const role of roles) {
        processed += await processWorkerRole(role, { ...options, once: true });
      }

      if (once || processed === 0) {
        if (processed === 0) {
          await logger.debug("orchestrator poll found no runnable work", {
            role: "orchestrator",
            properties: { pollIntervalMs },
          });
        }
        if (once) return;
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    } while (true);
  } finally {
    await loggerRepository.close();
  }
}

export async function runWorkerFlow(options: WorkerConfig): Promise<void> {
  const role = options.role;
  const pollIntervalMs = parseInt(String(options.pollInterval ?? DEFAULT_WORKER_POLL_INTERVAL_MS), 10);
  const once = options.once === true;
  const loggerRepository = createControlPlaneRepository(options);
  await loggerRepository.initialize();
  const logger = createRuntimeLogger(loggerRepository);

  try {
    do {
      const processed = await processWorkerRole(role, { ...options, once: true });
      if (once) return;
      if (processed === 0) {
        await logger.debug("worker poll found no runnable work", {
          role,
          properties: { pollIntervalMs },
        });
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    } while (true);
  } finally {
    await loggerRepository.close();
  }
}

function createLocalJobOrchestrator(options: CliOptions = {}): LocalJobOrchestrator {
  return new LocalJobOrchestrator(createControlPlaneRepository(options), {
    ...DEFAULT_RUNTIME_CONFIG,
    mode: options.runtimeMode === "distributed" ? "distributed" : "local",
    controlPlane: {
      ...DEFAULT_RUNTIME_CONFIG.controlPlane,
      postgresUrl: typeof options.postgresUrl === "string" ? options.postgresUrl : undefined,
    },
  });
}

async function runLocalWorkflowCommand<TResult>(
  workflowType: "download" | "process" | "sync" | "download-images" | "fetch-metadata" | "refresh",
  options: CliOptions,
  stagePlan: WorkflowStagePlanItem[],
  runner: (context: LocalWorkflowContext) => Promise<TResult>,
): Promise<{ jobId: string; result: TResult }> {
  const orchestrator = createLocalJobOrchestrator(options);
  return orchestrator.runWorkflow(
    {
      workflowType,
      payload: serializeJobPayload(options),
      stagePlan,
      onJobCreated: (jobId) => {
        console.log(`Job submitted: ${jobId}`);
      },
    },
    async (context) => {
      const result = await runner(context);
      console.log(`Job completed: ${context.job.id}`);
      return result;
    },
  );
}

async function processWorkerRole(
  role: "orchestrator" | "auth" | "metadata" | "asset" | "processing" | "conversion",
  options: CliOptions = {},
): Promise<number> {
  const repository = createControlPlaneRepository(options);
  try {
    await repository.initialize();
    const logger = createRuntimeLogger(repository);
    const workerInstanceId = `worker-${role}-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    await repository.upsertWorkerInstance({
      id: workerInstanceId,
      role,
      runtimeMode: "distributed",
      hostname: os.hostname(),
      processId: process.pid,
      startedAt: new Date(),
      heartbeatAt: new Date(),
      metadata: {
        kind: "worker-runtime",
        controlPlaneBackend: resolveControlPlaneBackend(options),
      },
    });
    await logger.info("worker polling for work", {
      workerInstanceId,
      role,
      properties: {
        runtimeMode: "distributed",
        controlPlaneBackend: resolveControlPlaneBackend(options),
      },
    });

    const claimed = await repository.claimNextRunnableWorkItem(role, workerInstanceId);
    if (!claimed) {
      await logger.debug("no runnable work claimed", {
        workerInstanceId,
        role,
      });
      return 0;
    }

    await logger.info("work item claimed", {
      workerInstanceId,
      role,
      jobId: claimed.job.id,
      stageId: claimed.stage.id,
      workItemId: claimed.workItem.id,
      workflowType: claimed.job.workflowType,
      properties: {
        stageType: claimed.stage.stageType,
      },
    });

    await executeClaimedWorkItem(repository, claimed, workerInstanceId);
    return 1;
  } finally {
    await repository.close();
  }
}

async function executeClaimedWorkItem(
  repository: ControlPlaneRepository,
  claimed: IClaimedWorkItem,
  workerInstanceId: string,
): Promise<void> {
  const leaseManager = new LeaseManager(repository, DEFAULT_RUNTIME_CONFIG);
  const logger = createRuntimeLogger(repository);
  const cancellationMessage = claimed.job.errorMessage || "Job cancelled by operator request";
  const cancellationAssertion = createJobCancellationAssertion(claimed.job.id, claimed.job.payload as CliOptions);
  const cancellationMonitor = createCancellationMonitor(cancellationAssertion);
  let lease: Awaited<ReturnType<LeaseManager["acquireStageLease"]>> | null = null;
  try {
    const currentJob = await repository.getJob(claimed.job.id);
    if (currentJob?.status === "cancelled") {
      await repository.updateStageStatus(claimed.stage.id, "cancelled", { completedAt: new Date(), errorMessage: cancellationMessage });
      await repository.updateWorkItemStatus(claimed.workItem.id, "cancelled", { completedAt: new Date(), errorMessage: cancellationMessage });
      await logger.info("skipping claimed work item because job is cancelled", {
        workerInstanceId,
        role: claimed.workItem.workerRole,
        jobId: claimed.job.id,
        workflowType: claimed.job.workflowType,
        stageId: claimed.stage.id,
        workItemId: claimed.workItem.id,
        properties: {
          stageType: claimed.stage.stageType,
        },
      });
      return;
    }

    const hasCapacity = await leaseManager.hasAvailableCapacity(claimed.stage.stageType);
    if (!hasCapacity) {
      await repository.updateStageStatus(claimed.stage.id, "blocked");
      await repository.updateWorkItemStatus(claimed.workItem.id, "blocked", {
        leaseOwnerId: undefined,
      });
      await logger.warn("work item blocked waiting for capacity", {
        workerInstanceId,
        role: claimed.workItem.workerRole,
        jobId: claimed.job.id,
        workflowType: claimed.job.workflowType,
        stageId: claimed.stage.id,
        workItemId: claimed.workItem.id,
        properties: {
          stageType: claimed.stage.stageType,
        },
      });
      return;
    }

    lease = await leaseManager.acquireStageLease({
      stageType: claimed.stage.stageType,
      workerInstanceId,
      workerRole: claimed.workItem.workerRole,
      jobId: claimed.job.id,
      stageId: claimed.stage.id,
      workItemId: claimed.workItem.id,
    });
    await logger.info("lease acquired for work item", {
      workerInstanceId,
      role: claimed.workItem.workerRole,
      jobId: claimed.job.id,
      workflowType: claimed.job.workflowType,
      stageId: claimed.stage.id,
      workItemId: claimed.workItem.id,
      properties: {
        stageType: claimed.stage.stageType,
        leaseId: lease?.id,
        resourceKey: lease?.resourceKey,
      },
    });

    const jobBeforeStart = await repository.getJob(claimed.job.id);
    if (jobBeforeStart?.status === "cancelled") {
      await repository.updateStageStatus(claimed.stage.id, "cancelled", { completedAt: new Date(), errorMessage: jobBeforeStart.errorMessage ?? cancellationMessage });
      await repository.updateWorkItemStatus(claimed.workItem.id, "cancelled", { completedAt: new Date(), errorMessage: jobBeforeStart.errorMessage ?? cancellationMessage });
      await leaseManager.releaseStageLease(lease);
      await logger.info("released claimed work item because job was cancelled before start", {
        workerInstanceId,
        role: claimed.workItem.workerRole,
        jobId: claimed.job.id,
        workflowType: claimed.job.workflowType,
        stageId: claimed.stage.id,
        workItemId: claimed.workItem.id,
        properties: {
          stageType: claimed.stage.stageType,
          leaseId: lease?.id,
        },
      });
      return;
    }

    await repository.updateJobStatus(claimed.job.id, "running", { startedAt: claimed.job.startedAt ?? new Date() });
    await repository.updateStageStatus(claimed.stage.id, "running", { startedAt: new Date() });
    await repository.updateWorkItemStatus(claimed.workItem.id, "running", { startedAt: new Date() });
    await logger.info("work item execution started", {
      workerInstanceId,
      role: claimed.workItem.workerRole,
      jobId: claimed.job.id,
      workflowType: claimed.job.workflowType,
      stageId: claimed.stage.id,
      workItemId: claimed.workItem.id,
      properties: {
        stageType: claimed.stage.stageType,
      },
    });

    const workflowOptions = {
      ...(claimed.job.payload as CliOptions),
      __assertNotCancelled: cancellationAssertion,
      __abortSignal: cancellationMonitor.signal,
    } as CliOptions;
    await executeStageHandler(claimed.job.workflowType, claimed.stage.stageType, workflowOptions);
    const jobAfterExecution = await repository.getJob(claimed.job.id);
    if (jobAfterExecution?.status === "cancelled") {
      await repository.updateStageStatus(claimed.stage.id, "cancelled", {
        completedAt: new Date(),
        errorMessage: jobAfterExecution.errorMessage ?? cancellationMessage,
      });
      await repository.updateWorkItemStatus(claimed.workItem.id, "cancelled", {
        completedAt: new Date(),
        errorMessage: jobAfterExecution.errorMessage ?? cancellationMessage,
      });
      await leaseManager.releaseStageLease(lease);
      await logger.info("work item observed cancellation after execution", {
        workerInstanceId,
        role: claimed.workItem.workerRole,
        jobId: claimed.job.id,
        workflowType: claimed.job.workflowType,
        stageId: claimed.stage.id,
        workItemId: claimed.workItem.id,
        properties: {
          stageType: claimed.stage.stageType,
          leaseId: lease?.id,
        },
      });
      return;
    }
    await repository.updateStageStatus(claimed.stage.id, "succeeded", { completedAt: new Date() });
    await repository.updateWorkItemStatus(claimed.workItem.id, "succeeded", { completedAt: new Date() });
    await leaseManager.releaseStageLease(lease);
    await logger.info("work item execution completed", {
      workerInstanceId,
      role: claimed.workItem.workerRole,
      jobId: claimed.job.id,
      workflowType: claimed.job.workflowType,
      stageId: claimed.stage.id,
      workItemId: claimed.workItem.id,
      properties: {
        stageType: claimed.stage.stageType,
        leaseId: lease?.id,
      },
    });

    const stages = await repository.listStages(claimed.job.id);
    if (stages.every((stage) => stage.status === "succeeded")) {
      await repository.updateJobStatus(claimed.job.id, "completed", { completedAt: new Date() });
      await logger.info("job completed in worker runtime", {
        workerInstanceId,
        role: claimed.workItem.workerRole,
        jobId: claimed.job.id,
        workflowType: claimed.job.workflowType,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const authFailureCode = claimed.stage.stageType === "authorization"
      ? classifyAuthFailure(message)
      : undefined;
    if (isCancellationError(error)) {
      await repository.cancelJob(claimed.job.id, {
        completedAt: new Date(),
        errorCode: "job_cancelled",
        errorMessage: message,
      });
      await repository.updateStageStatus(claimed.stage.id, "cancelled", { completedAt: new Date(), errorMessage: message });
      await repository.updateWorkItemStatus(claimed.workItem.id, "cancelled", { completedAt: new Date(), errorMessage: message });
      await leaseManager.releaseStageLease(lease);
      await logger.info("work item cancelled cooperatively", {
        workerInstanceId,
        role: claimed.workItem.workerRole,
        jobId: claimed.job.id,
        workflowType: claimed.job.workflowType,
        stageId: claimed.stage.id,
        workItemId: claimed.workItem.id,
        properties: {
          stageType: claimed.stage.stageType,
          leaseId: lease?.id,
        },
      });
      return;
    }
    const currentJobAfterError = await repository.getJob(claimed.job.id);
    if (currentJobAfterError?.status === "cancelled") {
      await repository.updateStageStatus(claimed.stage.id, "cancelled", {
        completedAt: new Date(),
        errorMessage: currentJobAfterError.errorMessage ?? cancellationMessage,
      });
      await repository.updateWorkItemStatus(claimed.workItem.id, "cancelled", {
        completedAt: new Date(),
        errorMessage: currentJobAfterError.errorMessage ?? cancellationMessage,
      });
      await leaseManager.releaseStageLease(lease);
      await logger.info("work item error ignored because job was cancelled", {
        workerInstanceId,
        role: claimed.workItem.workerRole,
        jobId: claimed.job.id,
        workflowType: claimed.job.workflowType,
        stageId: claimed.stage.id,
        workItemId: claimed.workItem.id,
        properties: {
          stageType: claimed.stage.stageType,
          leaseId: lease?.id,
        },
      });
      return;
    }
    await repository.updateStageStatus(claimed.stage.id, "failed", {
      completedAt: new Date(),
      errorCode: authFailureCode,
      errorMessage: message,
    });
    await repository.updateWorkItemStatus(claimed.workItem.id, "failed", {
      completedAt: new Date(),
      errorCode: authFailureCode,
      errorMessage: message,
    });
    await repository.updateJobStatus(claimed.job.id, "failed", {
      completedAt: new Date(),
      errorCode: authFailureCode,
      errorMessage: message,
    });
    await leaseManager.releaseStageLease(lease);
    console.error(`Worker stage failed [${claimed.stage.stageType}] for job ${claimed.job.id}: ${message}`);
    await logger.error("work item execution failed", {
      workerInstanceId,
      role: claimed.workItem.workerRole,
      jobId: claimed.job.id,
      workflowType: claimed.job.workflowType,
      stageId: claimed.stage.id,
      workItemId: claimed.workItem.id,
      properties: {
        stageType: claimed.stage.stageType,
        errorMessage: message,
        leaseId: lease?.id,
      },
    });
    throw error;
  } finally {
    cancellationMonitor.stop();
  }
}

async function executeStageHandler(
  workflowType: "download" | "process" | "sync" | "download-images" | "fetch-metadata" | "refresh",
  stageType: "authorization" | "metadata-acquisition" | "asset-acquisition" | "processing" | "conversion" | "finalization",
  options: CliOptions,
): Promise<void> {
  switch (workflowType) {
    case "download":
      if (stageType === "authorization") {
        await authService.getAuthenticatedClient(options);
      } else if (stageType === "asset-acquisition") {
        await runDownloadWorkflow(options);
      }
      return;
    case "process":
      if (stageType === "conversion") {
        await runProcessWorkflow(options);
      }
      return;
    case "download-images":
      if (stageType === "authorization") {
        await authService.getAuthenticatedClient(options);
      } else if (stageType === "asset-acquisition") {
        await runDownloadImagesWorkflow(options);
      }
      return;
    case "fetch-metadata":
      if (stageType === "authorization") {
        await authService.getAuthenticatedClient(options);
      } else if (stageType === "metadata-acquisition") {
        await runFetchMetadataWorkflow(options);
      }
      return;
    case "refresh":
      if (stageType === "authorization") {
        await authService.getAuthenticatedClient(options);
      } else if (stageType === "metadata-acquisition") {
        await runRefreshWorkflow(options);
      }
      return;
    case "sync":
      if (stageType === "authorization") {
        await authService.getAuthenticatedClient(options);
      } else if (stageType === "asset-acquisition") {
        await runDownloadWorkflow({
          ...options,
          exportMetadataJson: undefined,
          copySongsMetadataToOutput: false,
        });
      } else if (stageType === "conversion") {
        const outputDir = path.resolve(String(options.output));
        const conversionOutput = options.library || outputDir;
        const storeConfig = resolveMetadataStoreOptions(options);
        await runProcessWorkflow({
          input: outputDir,
          output: conversionOutput,
          databaseType: storeConfig.type,
          database: storeConfig.sqlitePath,
          postgresUrl: storeConfig.postgresUrl,
          copySongsMetadataToOutput: false,
          processFormats: options.processFormats,
          processBitrate: options.processBitrate,
          processConcurrency: options.processConcurrency,
          processUpdateConcurrency: options.processUpdateConcurrency,
          images: options.images,
          lyrics: options.lyrics,
          exitOnError: options.exitOnError,
          processClipIds: undefined,
        });
      } else if (stageType === "finalization") {
        const outputDir = path.resolve(String(options.output));
        const storeConfig = resolveMetadataStoreOptions(options);
        await exportMetadataJsonIfRequested(options, storeConfig, resolveMetadataJsonExportPath(outputDir, options));
      }
      return;
  }
}

function parseOptionalDate(value: unknown, label: string): Date | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date for ${label}: ${value}`);
  }
  return parsed;
}

function createApiClient(options: CliOptions): HttpApiClient {
  if (options.__apiClient) {
    return options.__apiClient as HttpApiClient;
  }

  return new HttpApiClient({
    baseUrl: typeof options.apiUrl === "string" ? options.apiUrl : undefined,
  });
}

function normalizeWorkflowTypeInput(value: string): WorkflowType {
  const trimmed = value.trim();
  switch (trimmed) {
    case "download":
    case "process":
    case "sync":
    case "download-images":
    case "fetch-metadata":
    case "refresh":
      return trimmed;
    default:
      throw new Error(`Unsupported workflow type: ${value}`);
  }
}

async function readApiWorkflowPayload(payloadPath: unknown): Promise<Record<string, unknown>> {
  if (typeof payloadPath !== "string" || payloadPath.trim().length === 0) {
    throw new Error("api submit requires --payload <path> or --payload - for stdin");
  }

  const resolvedPath = payloadPath.trim();
  const raw = resolvedPath === "-"
    ? await readStdinText()
    : await fs.promises.readFile(path.resolve(resolvedPath), "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in workflow payload: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Workflow payload must be a JSON object");
  }

  return parsed as Record<string, unknown>;
}

async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function printJobSnapshot(snapshot: IJobSnapshot, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  if (!snapshot.job) {
    console.log("Job not found.");
    return;
  }

  console.log(`Job ${snapshot.job.id}`);
  console.log(`  Workflow: ${snapshot.job.workflowType}`);
  console.log(`  Status: ${snapshot.job.status}`);
  if (snapshot.job.startedAt) {
    console.log(`  Started: ${snapshot.job.startedAt.toISOString()}`);
  }
  if (snapshot.job.completedAt) {
    console.log(`  Completed: ${snapshot.job.completedAt.toISOString()}`);
  }
  if (snapshot.stages.length > 0) {
    console.log("\nStages:");
    snapshot.stages.forEach((stage) => {
      console.log(`  ${stage.sequence}. ${stage.stageType} [${stage.status}]`);
    });
  }
}

function resolveBrowserEndpoint(options: CliOptions): string | undefined {
  const browser = options.browser;
  if (browser == null || browser === false) return undefined;
  if (browser === true) return "http://localhost:9222";
  if (typeof browser === "string") {
    const trimmed = browser.trim();
    return trimmed.length > 0 ? trimmed : "http://localhost:9222";
  }
  return "http://localhost:9222";
}

function resolveBrowserUserDataDir(options: CliOptions): string | undefined {
  if (typeof options.browserProfile !== "string") return undefined;
  const trimmed = options.browserProfile.trim();
  return trimmed.length > 0 ? path.resolve(trimmed) : undefined;
}

function resolveBrowserProfileDirectory(options: CliOptions): string | undefined {
  if (typeof options.profileDirectory !== "string") return undefined;
  const trimmed = options.profileDirectory.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function printLogsResult(result: ILogQueryResult, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.entries.length === 0) {
    console.log("No logs matched the requested filters.");
    return;
  }

  result.entries.forEach((entry) => {
    const segments = [
      entry.timestamp.toISOString(),
      entry.level.toUpperCase(),
      entry.context?.workflowType,
      entry.context?.role,
      entry.context?.jobId,
      entry.context?.stageId,
      entry.context?.workItemId,
      entry.message,
    ].filter((segment): segment is string => Boolean(segment));
    console.log(segments.join(" | "));
  });
}
