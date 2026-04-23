import * as fs from "fs";
import * as path from "path";
import { SunoClient } from "./client";
import type { IWorkspace } from "./lib/interfaces";
import { LocalControlPlaneRepository, LocalJobOrchestrator, type LocalWorkflowContext } from "./orchestration";
import {
  AssetAcquisitionService,
  AuthService,
  configureAssetAcquisitionService,
  configureMetadataAcquisitionService,
  ConversionService,
  filterWorkspaces,
  getAuthenticatedClientWithDeps,
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

export { getAuthenticatedClientWithDeps };
export type { AuthClient, AuthDeps, AuthStorage };

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
      __storage: new Storage(),
    },
    client,
  );
}

async function runProcessWorkflow(options: CliOptions): Promise<void> {
  const outputDir = path.resolve(options.output);
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

export async function runImportMetadataJsonFlow(options: CliOptions): Promise<void> {
  const storeConfig = resolveMetadataStoreOptions(options);
  logMetadataImportStatus(`Starting import from ${path.resolve(options.input)}`);
  logMetadataImportStatus(`Target database: ${describeMetadataStoreConfig(storeConfig)}`);
  const result = await importMetadataJsonToDatabase(options.input, storeConfig, {
    log: logMetadataImportStatus,
  });
  console.log(`Imported ${result.imported} metadata entr${result.imported === 1 ? "y" : "ies"} to ${result.databasePath}`);
}

export async function runExportMetadataJsonFlow(options: CliOptions): Promise<void> {
  const storeConfig = resolveMetadataStoreOptions(options);
  logMetadataImportStatus(`Starting export to ${path.resolve(options.output)}`);
  logMetadataImportStatus(`Source database: ${describeMetadataStoreConfig(storeConfig)}`);
  const result = await exportMetadataDatabaseToJson(options.output, storeConfig, {
    log: logMetadataImportStatus,
  });
  console.log(`Exported ${result.exported} metadata entr${result.exported === 1 ? "y" : "ies"} to ${result.jsonFilePath}`);
}

async function runSyncWorkflow(options: CliOptions): Promise<void> {
  const outputDir = path.resolve(options.output);
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
  await runLocalWorkflowCommand("sync", options, [
    { type: "authorization", workerRole: "auth" },
    { type: "asset-acquisition", workerRole: "asset" },
    { type: "processing", workerRole: "processing" },
    { type: "conversion", workerRole: "conversion" },
    { type: "finalization", workerRole: "orchestrator" },
  ], async ({ runStage }) => {
    const client = await runStage("authorization", async () => authService.getAuthenticatedClient(options));
    const outputDir = path.resolve(options.output);
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

export async function runJobStatusFlow(jobId: string, options: CliOptions = {}): Promise<void> {
  const orchestrator = createLocalJobOrchestrator();
  const snapshot = await orchestrator.getJobSnapshot(jobId);
  if (!snapshot.job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  if (options.json) {
    console.log(JSON.stringify(snapshot, null, 2));
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

export async function runWatchJobFlow(jobId: string, options: CliOptions = {}): Promise<void> {
  const intervalMs = parseInt(String(options.interval ?? DEFAULT_WATCH_INTERVAL_MS), 10);
  while (true) {
    const orchestrator = createLocalJobOrchestrator();
    const snapshot = await orchestrator.getJobSnapshot(jobId);
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

function createLocalJobOrchestrator(): LocalJobOrchestrator {
  return new LocalJobOrchestrator(new LocalControlPlaneRepository());
}

async function runLocalWorkflowCommand<TResult>(
  workflowType: "download" | "process" | "sync" | "download-images" | "fetch-metadata" | "refresh",
  options: CliOptions,
  stagePlan: Array<{ type: "authorization" | "metadata-acquisition" | "asset-acquisition" | "processing" | "conversion" | "finalization"; workerRole: "orchestrator" | "auth" | "metadata" | "asset" | "processing" | "conversion" }>,
  runner: (context: LocalWorkflowContext) => Promise<TResult>,
): Promise<{ jobId: string; result: TResult }> {
  const orchestrator = createLocalJobOrchestrator();
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

function serializeJobPayload(options: CliOptions): Record<string, unknown> {
  return JSON.parse(JSON.stringify(options, (_key, value) => {
    if (typeof value === "function") return undefined;
    if (value instanceof Date) return value.toISOString();
    if (value instanceof SunoClient) return undefined;
    return value;
  })) as Record<string, unknown>;
}
