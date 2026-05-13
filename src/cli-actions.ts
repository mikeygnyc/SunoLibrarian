import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {humanId, poolSize, minLength, maxLength} from 'human-id'
import { buildAuthConfig, captureAuthTokenWithDeps, extractTokenFromBrowser } from "./lib/auth/auth";
import { createCancellationMonitor, isCancellationError } from "./cancellation";
import { HttpApiClient } from "./http-api-client";
import type { LibrarianConfig, WorkerConfig } from "./app-config";
import type {
  IClaimedWorkItem,
  IHttpApiDownloadImagesWorkflowRequest,
  IHttpApiDownloadWorkflowRequest,
  IHttpApiFetchMetadataWorkflowRequest,
  IHttpApiProcessWorkflowRequest,
  IHttpApiRefreshWorkflowRequest,
  IHttpApiSyncWorkflowRequest,
  IJobSnapshot,
  ILogQueryResult,
  WorkerRole,
  WorkflowType,
} from "./core/contracts";
import { DEFAULT_RUNTIME_CONFIG, LeaseManager, classifyAuthFailure, createControlPlaneRepository, createJobCancellationAssertion, createRuntimeLogger, getJobSnapshot, resolveControlPlaneBackend, serializeJobPayload, submitWorkflowJob, type ControlPlaneRepository } from "./core/orchestration";
import {
  AssetAcquisitionService,
  AuthService,
  configureAssetAcquisitionService,
  configureMetadataAcquisitionService,
  ConversionService,
  filterWorkspaces,
  LibrarianService,
  MetadataAcquisitionService,
  ProcessingPlannerService,
  type AuthClient,
  type AuthDeps,
  type AuthStorage,
  type CliOptions,
  type DownloadFlowResult,
} from "./core/services";
import { Storage } from "./storage";
import { startRuntimeHealthServer } from "./supervisor/runtime-health";
import {
  describeMetadataStoreConfig,
  exportMetadataDatabaseToJson,
  importMetadataJsonToDatabase,
  MetadataStoreConfig,
  resolveMetadataStoreConfig,
} from "./metadata-store";
import { resolveWorkflowTarget } from "./workflow-target-config";

const DEFAULT_METADATA_FILENAME = "songs_metadata.json";
const DEFAULT_WATCH_INTERVAL_MS = 1000;
const DEFAULT_WORKER_POLL_INTERVAL_MS = 500;
const DEFAULT_RUNTIME_STALE_AFTER_MS = 60_000;

export type { AuthClient, AuthDeps, AuthStorage };
export type { CaptureAuthTokenDeps } from "./lib/auth/auth";
export { captureAuthTokenWithDeps };

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
  const workflowTarget = resolveWorkflowTarget(options);
  if (workflowTarget?.kind === "local") {
    const metadataRoot = resolveLocalMetadataRoot(options, workflowTarget.localRoot);
    return {
      type: "file",
      jsonFilePath: resolveMetadataFilePath(metadataRoot, options),
    };
  }

  return resolveMetadataStoreConfig({
    databaseType: options.databaseType,
    database: typeof options.database === "string" ? options.database : undefined,
    postgresUrl: typeof options.postgresUrl === "string" ? options.postgresUrl : undefined,
  });
}

function resolveLocalMetadataRoot(options: CliOptions, defaultRoot: string): string {
  if (typeof options.input === "string" && options.input.trim().length > 0) {
    return path.resolve(options.input.trim());
  }
  if (typeof options.output === "string" && options.output.trim().length > 0) {
    return path.resolve(options.output.trim());
  }
  return path.resolve(defaultRoot);
}

function resolveLocalDownloadOptions(options: CliOptions, localRoot: string): CliOptions {
  return {
    ...options,
    localRoot,
    output: typeof options.output === "string" && options.output.trim().length > 0
      ? options.output
      : localRoot,
  };
}

function resolveLocalProcessOptions(options: CliOptions, localRoot: string): CliOptions {
  const input = typeof options.input === "string" && options.input.trim().length > 0
    ? options.input
    : localRoot;
  const output = typeof options.output === "string" && options.output.trim().length > 0
    ? options.output
    : localRoot;

  return {
    ...options,
    localRoot,
    input,
    output,
  };
}

function resolveLocalSyncOptions(options: CliOptions, localRoot: string): CliOptions {
  const output = typeof options.output === "string" && options.output.trim().length > 0
    ? options.output
    : localRoot;
  const library = typeof options.library === "string" && options.library.trim().length > 0
    ? options.library
    : output;

  return {
    ...options,
    localRoot,
    output,
    library,
  };
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

async function runDownloadWorkflow(options: CliOptions): Promise<DownloadFlowResult> {
  const client = await authService.getAuthenticatedClient(options);
  return assetAcquisitionService.downloadTracks(
    {
      ...options,
      __storage: new Storage({ cacheDir: options.cacheDir }),
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

export async function runClearAuthTokenFlow(options: CliOptions = {}): Promise<void> {
  const storage = new Storage({ cacheDir: options.cacheDir });
  storage.clearAuthToken();
  console.log("Cached authentication token cleared.");
}

export async function runCaptureAuthTokenFlow(options: CliOptions = {}): Promise<void> {
  options = { ...options, saveLocal: true };
  await captureAuthTokenWithDeps(options, {
    extractTokenFromBrowser,
    storage: new Storage({ cacheDir: options.cacheDir }),
    log: console,
  });
}

export async function runImportMetadataJsonFlow(options: CliOptions): Promise<void> {
  const storeConfig = resolveMetadataStoreOptions(options);
  logMetadataImportStatus(`Starting import from ${path.resolve(String(options.input))}`);
  logMetadataImportStatus(`Target metadata store: ${describeMetadataStoreConfig(storeConfig)}`);
  const result = await importMetadataJsonToDatabase(String(options.input), storeConfig, {
    log: logMetadataImportStatus,
  });
  console.log(`Imported ${result.imported} metadata entr${result.imported === 1 ? "y" : "ies"} to ${result.databasePath}`);
}

export async function runExportMetadataJsonFlow(options: CliOptions): Promise<void> {
  const storeConfig = resolveMetadataStoreOptions(options);
  logMetadataImportStatus(`Starting export to ${path.resolve(String(options.output))}`);
  logMetadataImportStatus(`Source metadata store: ${describeMetadataStoreConfig(storeConfig)}`);
  const result = await exportMetadataDatabaseToJson(String(options.output), storeConfig, {
    log: logMetadataImportStatus,
  });
  console.log(`Exported ${result.exported} metadata entr${result.exported === 1 ? "y" : "ies"} to ${result.jsonFilePath}`);
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
  const workflowTarget = resolveWorkflowTarget(options);
  if (workflowTarget?.kind === "local") {
    return runDownloadWorkflow(resolveLocalDownloadOptions(options, workflowTarget.localRoot));
  }

  if (workflowTarget?.kind === "api") {
    options = { ...options, apiUrl: workflowTarget.apiUrl };
  } else {
    throw new Error("download requires either --api-url or a config file with target.apiUrl or target.localRoot");
  }
  const result = await submitCliWorkflow("download", buildDownloadWorkflowRequest(options), options);
  console.log(`Job submitted: ${result.jobId}`);
  return {
    outputDir: path.resolve(String(options.output ?? ".")),
    downloaded: 0,
    skipped: 0,
  };
}

export async function runProcessFlow(options: CliOptions): Promise<void> {
  const workflowTarget = resolveWorkflowTarget(options);
  if (workflowTarget?.kind === "local") {
    await runProcessWorkflow(resolveLocalProcessOptions(options, workflowTarget.localRoot));
    return;
  }

  if (workflowTarget?.kind === "api") {
    options = { ...options, apiUrl: workflowTarget.apiUrl };
  } else {
    throw new Error("process requires either --api-url or a config file with target.apiUrl or target.localRoot");
  }
  const result = await submitCliWorkflow("process", buildProcessWorkflowRequest(options), options);
  console.log(`Job submitted: ${result.jobId}`);
}

export async function runSyncFlow(options: CliOptions): Promise<void> {
  const workflowTarget = resolveWorkflowTarget(options);
  if (workflowTarget?.kind === "local") {
    const localOptions = resolveLocalSyncOptions(options, workflowTarget.localRoot);
    await runDownloadWorkflow({
      ...localOptions,
      exportMetadataJson: undefined,
      copySongsMetadataToOutput: false,
    });
    await runProcessWorkflow({
      ...localOptions,
      input: String(localOptions.output),
      output: String(localOptions.library ?? localOptions.output),
      copySongsMetadataToOutput: false,
    });
    await exportMetadataJsonIfRequested(
      localOptions,
      resolveMetadataStoreOptions(localOptions),
      resolveMetadataJsonExportPath(path.resolve(String(localOptions.output)), localOptions),
    );
    return;
  }

  if (workflowTarget?.kind === "api") {
    options = { ...options, apiUrl: workflowTarget.apiUrl };
  } else {
    throw new Error("sync requires either --api-url or a config file with target.apiUrl or target.localRoot");
  }
  const result = await submitCliWorkflow("sync", buildSyncWorkflowRequest(options), options);
  console.log(`Job submitted: ${result.jobId}`);
}

export async function runDownloadImagesFlow(options: CliOptions): Promise<void> {
  options = withResolvedApiTarget(options, "download-images");
  const result = await submitCliWorkflow("download-images", buildDownloadImagesWorkflowRequest(options), options);
  console.log(`Job submitted: ${result.jobId}`);
}

export async function runFetchMetadataFlow(options: CliOptions): Promise<void> {
  options = withResolvedApiTarget(options, "fetch-metadata");
  const result = await submitCliWorkflow("fetch-metadata", buildFetchMetadataWorkflowRequest(options), options);
  console.log(`Job submitted: ${result.jobId}`);
}

export async function runRefreshFlow(options: CliOptions): Promise<void> {
  options = withResolvedApiTarget(options, "refresh");
  const result = await submitCliWorkflow("refresh", buildRefreshWorkflowRequest(options), options);
  console.log(`Job submitted: ${result.jobId}`);
}

export async function runLibrarianFlow(options: LibrarianConfig): Promise<void> {
  const healthServer = await startRuntimeHealthServer({
    service: "librarian",
    role: "librarian",
    host: options.healthHost,
    port: options.healthPort,
    workspaceId: options.workspace,
  });

  try {
    healthServer?.markReady();
    await librarianService.run(options);
  } finally {
    await healthServer?.close();
  }
}

export async function runJobStatusFlow(jobId: string, options: CliOptions = {}): Promise<void> {
  options = withResolvedApiTarget(options, "job-status");
  const snapshot = await createApiClient(options).getJob(jobId);
  printJobSnapshot(snapshot, options.json === true);
}

export async function runWatchJobFlow(jobId: string, options: CliOptions = {}): Promise<void> {
  options = withResolvedApiTarget(options, "watch-job");
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

export async function runLogsFlow(options: CliOptions = {}): Promise<void> {
  options = withResolvedApiTarget(options, "logs");
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

export async function runApiHealthFlow(options: CliOptions = {}): Promise<void> {
  options = withResolvedApiTarget(options, "api-health");
  const result = await createApiClient(options).getHealth();
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(result.ok ? "API is healthy." : "API is unhealthy.");
}

export async function runApiSubmitWorkflowFlow(workflow: string, options: CliOptions = {}): Promise<void> {
  options = withResolvedApiTarget(options, "api-submit");
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

export async function runApiCancelJobFlow(jobId: string, options: CliOptions = {}): Promise<void> {
  options = withResolvedApiTarget(options, "api-cancel-job");
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

export async function runWorkerFlow(options: WorkerConfig): Promise<void> {
  const role = options.role;
  const pollIntervalMs = parseInt(String(options.pollInterval ?? DEFAULT_WORKER_POLL_INTERVAL_MS), 10);
  const once = options.once === true;
  const healthServer = await startRuntimeHealthServer({
    service: "worker",
    role,
    host: options.healthHost,
    port: options.healthPort,
  });
  const loggerRepository = createControlPlaneRepository(options);

  try {
    await loggerRepository.initialize();
    const logger = createRuntimeLogger(loggerRepository);

    healthServer?.markReady();
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
    await healthServer?.close();
    await loggerRepository.close();
  }
}

async function processWorkerRole(
  role: WorkerRole,
  options: CliOptions = {},
): Promise<number> {
  const repository = createControlPlaneRepository(options);
  try {
    await repository.initialize();
    const logger = createRuntimeLogger(repository);
    const staleBefore = new Date(Date.now() - DEFAULT_RUNTIME_STALE_AFTER_MS);
    const cleanup = await repository.cleanupStaleRuntimeState(staleBefore);
    const workerInstanceId = `worker-${role}-${process.pid}-${humanId({ separator: "-",capitalize:false})}`;
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
    if (cleanup.expiredLeaseCount > 0 || cleanup.removedWorkerInstanceCount > 0) {
      await logger.info("stale runtime state cleaned before polling", {
        workerInstanceId,
        role,
        properties: {
          expiredLeaseCount: cleanup.expiredLeaseCount,
          removedWorkerInstanceCount: cleanup.removedWorkerInstanceCount,
          controlPlaneBackend: resolveControlPlaneBackend(options),
        },
      });
    }
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

function withResolvedApiTarget(options: CliOptions, commandName: string): CliOptions {
  if (options.__apiClient) {
    return options;
  }
  const workflowTarget = resolveWorkflowTarget(options);
  if (workflowTarget?.kind === "local") {
    throw new Error(`${commandName} requires an API target; the current config points at localRoot`);
  }
  if (workflowTarget?.kind === "api") {
    return { ...options, apiUrl: workflowTarget.apiUrl };
  }
  if (typeof options.apiUrl === "string" && options.apiUrl.trim().length > 0) {
    return options;
  }
  throw new Error(`${commandName} requires either --api-url or a config file with target.apiUrl`);
}

async function submitCliWorkflow<TWorkflowType extends WorkflowType>(
  workflowType: TWorkflowType,
  payload: (
    TWorkflowType extends "download" ? IHttpApiDownloadWorkflowRequest :
    TWorkflowType extends "process" ? IHttpApiProcessWorkflowRequest :
    TWorkflowType extends "sync" ? IHttpApiSyncWorkflowRequest :
    TWorkflowType extends "download-images" ? IHttpApiDownloadImagesWorkflowRequest :
    TWorkflowType extends "fetch-metadata" ? IHttpApiFetchMetadataWorkflowRequest :
    IHttpApiRefreshWorkflowRequest
  ),
  options: CliOptions,
) {
  return createApiClient(options).submitWorkflow(workflowType, payload);
}

function parseCsvList(value: unknown): string[] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

function parsePositiveInteger(value: unknown, label: string): number | undefined {
  if (value == null) {
    return undefined;
  }
  const parsed = parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function buildDownloadWorkflowRequest(options: CliOptions): IHttpApiDownloadWorkflowRequest {
  return {
    auth: buildAuthConfig(options),
    workspaceId: typeof options.workspace === "string" ? options.workspace : undefined,
    format: options.format === "mp3" || options.format === "wav" ? options.format : undefined,
    createdAfter: typeof options.createdAfter === "string" ? options.createdAfter : undefined,
    createdBefore: typeof options.createdBefore === "string" ? options.createdBefore : undefined,
    flushCache: options.flushCache === true ? true : undefined,
  };
}

function buildProcessWorkflowRequest(options: CliOptions): IHttpApiProcessWorkflowRequest {
  return {
    auth: buildAuthConfig(options),
    formats: parseCsvList(options.processFormats),
    bitrateKbps: parsePositiveInteger(options.processBitrate, "--process-bitrate"),
    embedImages: options.images === true ? true : undefined,
    embedLyrics: options.lyrics === true ? true : undefined,
    exitOnError: options.exitOnError === true ? true : undefined,
    reconvertBefore: typeof options.reconvertBefore === "string" ? options.reconvertBefore : undefined,
    reconvertAfter: typeof options.reconvertAfter === "string" ? options.reconvertAfter : undefined,
    reconvertMissing: options.reconvertMissing === true ? true : undefined,
    clipIds: Array.isArray(options.processClipIds) ? options.processClipIds : parseCsvList(options.processClipIds),
  };
}

function buildSyncWorkflowRequest(options: CliOptions): IHttpApiSyncWorkflowRequest {
  return {
    ...buildProcessWorkflowRequest(options),
    workspaceId: typeof options.workspace === "string" ? options.workspace : undefined,
    format: options.format === "mp3" || options.format === "wav" ? options.format : undefined,
    createdAfter: typeof options.createdAfter === "string" ? options.createdAfter : undefined,
    createdBefore: typeof options.createdBefore === "string" ? options.createdBefore : undefined,
    flushCache: options.flushCache === true ? true : undefined,
    processExistingMetadata: options.processExistingMetadata === true ? true : undefined,
  };
}

function buildDownloadImagesWorkflowRequest(options: CliOptions): IHttpApiDownloadImagesWorkflowRequest {
  return {
    auth: buildAuthConfig(options),
    listPath: typeof options.list === "string" ? options.list : undefined,
    fetchImageListPath: typeof options.fetchImageList === "string" ? options.fetchImageList : undefined,
    fetchMissing: options.fetchMissing === true ? true : undefined,
  };
}

function buildFetchMetadataWorkflowRequest(options: CliOptions): IHttpApiFetchMetadataWorkflowRequest {
  return {
    auth: buildAuthConfig(options),
    workspaceId: typeof options.workspace === "string" ? options.workspace : undefined,
    trackIds: parseCsvList(options.ids),
    createdAfter: typeof options.createdAfter === "string" ? options.createdAfter : undefined,
    createdBefore: typeof options.createdBefore === "string" ? options.createdBefore : undefined,
  };
}

function buildRefreshWorkflowRequest(options: CliOptions): IHttpApiRefreshWorkflowRequest {
  return {
    auth: buildAuthConfig(options),
  };
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
  const startedAt = formatTimestamp(snapshot.job.startedAt);
  if (startedAt) {
    console.log(`  Started: ${startedAt}`);
  }
  const completedAt = formatTimestamp(snapshot.job.completedAt);
  if (completedAt) {
    console.log(`  Completed: ${completedAt}`);
  }
  if (snapshot.stages.length > 0) {
    console.log("\nStages:");
    snapshot.stages.forEach((stage) => {
      console.log(`  ${stage.sequence}. ${stage.stageType} [${stage.status}]`);
    });
  }
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
      formatTimestamp(entry.timestamp) ?? String(entry.timestamp),
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

function formatTimestamp(value: unknown): string | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return undefined;
}
