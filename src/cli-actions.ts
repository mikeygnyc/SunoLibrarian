import * as fs from "fs";
import * as path from "path";
import { extractTokenFromBrowser } from "./auth";
import { SunoClient } from "./client";
import { runConverter } from "./converter";
import { Processor } from "./library-processor";
import { normalizeMetadata } from "./lib/metadata/normalize-metadata";
import { AudioFormat, ISongData, ISunoTrackResponse, IWorkspace } from "./lib/interfaces";
import { LocalControlPlaneRepository, LocalJobOrchestrator, type LocalWorkflowContext } from "./orchestration";
import { Storage } from "./storage";
import {
  createMetadataStore,
  describeMetadataStoreConfig,
  exportMetadataDatabaseToJson,
  importMetadataJsonToDatabase,
  MetadataStoreConfig,
  resolveMetadataStoreConfig,
} from "./metadata-store";

type CliOptions = Record<string, any>;
const DEFAULT_BROWSER_ENDPOINT = "http://localhost:9222";
const DEFAULT_METADATA_FILENAME = "songs_metadata.json";
const DEFAULT_WATCH_INTERVAL_MS = 1000;

export type AuthStorage = Pick<Storage, "getAuthToken" | "setAuthToken">;

export type AuthClient = {
  fetchWorkspacesPage(page?: number): Promise<any>;
};

export type AuthDeps<TClient extends AuthClient> = {
  storage: AuthStorage;
  createClient: (
    token: string,
    browserEndpoint?: string,
    browserUserDataDir?: string,
    browserProfileDirectory?: string,
  ) => TClient;
  extractTokenFromBrowser: typeof extractTokenFromBrowser;
  log: Pick<Console, "error" | "log" | "warn">;
};

type DownloadFlowResult = {
  outputDir: string;
  downloaded: number;
  skipped: number;
};

type DownloadedTrackHook = (params: {
  clipId: string;
  outputDir: string;
}) => void;

type DateBoundary = "start" | "end";

function parseDateFilter(value: string | undefined, label: string, boundary: DateBoundary): Date | undefined {
  if (!value) return undefined;

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  if (dateOnly) {
    const suffix = boundary === "start" ? "T00:00:00.000Z" : "T23:59:59.999Z";
    const parsedDateOnly = new Date(`${value.trim()}${suffix}`);
    if (Number.isNaN(parsedDateOnly.getTime())) {
      throw new Error(`Invalid date for ${label}: ${value}`);
    }
    return parsedDateOnly;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date for ${label}: ${value}`);
  }
  return parsed;
}

function getCreatedAtFilters(options: CliOptions): { createdAfter?: Date; createdBefore?: Date } {
  const createdAfter = parseDateFilter(options.createdAfter, "--created-after", "start");
  const createdBefore = parseDateFilter(options.createdBefore, "--created-before", "end");

  if (createdAfter && createdBefore && createdAfter > createdBefore) {
    throw new Error("--created-after must be earlier than or equal to --created-before");
  }

  return { createdAfter, createdBefore };
}

function isTrackInDateWindow(
  track: { created_at?: string },
  createdAfter?: Date,
  createdBefore?: Date,
): boolean {
  if (!createdAfter && !createdBefore) return true;
  if (!track.created_at) return false;

  const createdAt = new Date(track.created_at);
  if (Number.isNaN(createdAt.getTime())) return false;
  if (createdAfter && createdAt < createdAfter) return false;
  if (createdBefore && createdAt > createdBefore) return false;
  return true;
}

function parseTrackIdsOption(value: string | undefined): string[] {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ),
  );
}

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

async function saveWorkspacesToDatabase(options: CliOptions, workspaces: IWorkspace[]): Promise<void> {
  const store = await createMetadataStore(resolveMetadataStoreOptions(options));
  try {
    await store.upsertWorkspaces(workspaces);
  } finally {
    await store.close();
  }
}

async function saveTrackWorkspaceLinks(
  options: CliOptions,
  workspace: IWorkspace,
  clipIds: string[],
): Promise<void> {
  const store = await createMetadataStore(resolveMetadataStoreOptions(options));
  try {
    await store.upsertWorkspaces([workspace]);
    for (const clipId of clipIds) {
      await store.upsertSongWorkspace(clipId, workspace, "discovery");
    }
  } finally {
    await store.close();
  }
}

async function getImagesNeedingDownload(
  rootDir: string,
  storeConfig?: MetadataStoreConfig,
): Promise<Array<{ clipId: string; thumbnail: string | null }>> {
  const processor = new Processor({
    inputRoot: rootDir,
    outputRoot: rootDir,
    metadataDatabaseType: storeConfig?.type,
    metadataDatabasePath: storeConfig?.sqlitePath,
    metadataPostgresUrl: storeConfig?.postgresUrl,
    formats: ["flac", "mp3", "alac"] as AudioFormat[],
    mp3Bitrate: 320,
    embedImages: true,
    embedLyrics: true,
    exitOnError: false,
  });
  return processor.getImagesNeedingDownload();
}

function shouldCopySongsMetadataToOutput(options: CliOptions): boolean {
  return options.copySongsMetadataToOutput === true;
}

function resolveBrowserEndpoint(options: CliOptions): string | undefined {
  const browser = options.browser;
  if (browser == null || browser === false) return undefined;
  if (browser === true) return DEFAULT_BROWSER_ENDPOINT;
  if (typeof browser === "string") {
    const trimmed = browser.trim();
    return trimmed.length > 0 ? trimmed : DEFAULT_BROWSER_ENDPOINT;
  }
  return DEFAULT_BROWSER_ENDPOINT;
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

function isAuthFailure(error: any): boolean {
  return error?.status === 401 || error?.status === 403;
}

function createClient(
  token: string,
  browserEndpoint?: string,
  browserUserDataDir?: string,
  browserProfileDirectory?: string,
): SunoClient {
  return new SunoClient(
    token,
    undefined,
    browserEndpoint,
    browserUserDataDir,
    browserProfileDirectory,
  );
}

export async function getAuthenticatedClientWithDeps<TClient extends AuthClient>(
  options: CliOptions,
  deps: AuthDeps<TClient>,
): Promise<TClient> {
  const browserEndpoint = resolveBrowserEndpoint(options);
  const browserUserDataDir = resolveBrowserUserDataDir(options);
  const browserProfileDirectory = resolveBrowserProfileDirectory(options);
  const ignoreCachedToken = options.ignoreCachedToken === true;

  if (!ignoreCachedToken) {
    const cachedToken = deps.storage.getAuthToken();
    if (cachedToken) {
      const cachedClient = deps.createClient(
        cachedToken,
        browserEndpoint,
        browserUserDataDir,
        browserProfileDirectory,
      );

      try {
        await cachedClient.fetchWorkspacesPage(1);
        deps.log.error("Using cached authentication token.");
        return cachedClient;
      } catch (error: any) {
        if (!isAuthFailure(error)) {
          throw error;
        }
        deps.log.warn("Cached authentication token was rejected. Falling back to configured auth method.");
      }
    }
  }

  if (!options.token && !browserEndpoint) {
    throw new Error("Authentication required: provide either --token or --browser");
  }

  let token = options.token;
  if (!token) {
    deps.log.log("No token provided. Launching browser to extract token...");
    token = await deps.extractTokenFromBrowser(browserEndpoint, {
      userDataDir: browserUserDataDir,
      profileDirectory: browserProfileDirectory,
    });
    deps.log.log("Token extracted successfully!");
  }

  deps.storage.setAuthToken(token);
  return deps.createClient(
    token,
    browserEndpoint,
    browserUserDataDir,
    browserProfileDirectory,
  );
}

async function getAuthenticatedClient(options: CliOptions): Promise<SunoClient> {
  if (options.__authenticatedClient) {
    return options.__authenticatedClient as SunoClient;
  }

  return getAuthenticatedClientWithDeps(options, {
    storage: new Storage(),
    createClient,
    extractTokenFromBrowser,
    log: console,
  });
}

function filterWorkspaces(workspaces: IWorkspace[], workspaceId?: string): IWorkspace[] {
  return workspaceId ? workspaces.filter((w) => w.id === workspaceId) : workspaces;
}

function getPreferredImageUrl(metadata: any, fallback?: string | null): string | null {
  return (
    metadata?.fullData?.image_large_url ||
    metadata?.fullData?.metadata?.image_large_url ||
    metadata?.coverArt ||
    fallback ||
    null
  );
}

async function runDownloadWorkflow(options: CliOptions): Promise<DownloadFlowResult> {
  const client = await getAuthenticatedClient(options);
  const { createdAfter, createdBefore } = getCreatedAtFilters(options);

  if (options.flushCache) {
    console.log("Flushing cache...");
    const storage = new Storage();
    storage.clearCache();
  }

  const outputDir = path.resolve(options.output);
  const delay = parseInt(options.delay, 10);

  const mp3Dir = path.join(outputDir, "mp3");
  const wavDir = path.join(outputDir, "wav");
  const metadataDir = path.join(outputDir, "metadata");
  const imagesDir = path.join(outputDir, "images");

  [mp3Dir, wavDir, metadataDir, imagesDir].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  const storeConfig = resolveMetadataStoreOptions(options);
  const metadataJsonPath = resolveMetadataJsonExportPath(outputDir, options);
  await importMetadataJsonIfRequested(options, storeConfig);
  const metadataStore = await createMetadataStore(storeConfig);
  console.log(`Metadata database: ${describeMetadataStoreConfig(storeConfig)}`);
  console.log("Using targeted metadata lookups from the database");

  try {
    console.log("Fetching workspaces...");
    const workspaces = await client.getWorkspaces();
    await metadataStore.upsertWorkspaces(workspaces);
    console.log(`Found ${workspaces.length} workspace(s)`);

    const targetWorkspaces = filterWorkspaces(workspaces, options.workspace);
    if (targetWorkspaces.length === 0) {
      throw new Error("No matching workspaces found");
    }

    if (createdAfter || createdBefore) {
      const afterText = createdAfter ? createdAfter.toISOString() : "none";
      const beforeText = createdBefore ? createdBefore.toISOString() : "none";
      console.log(`Applying track creation-date filter: after=${afterText}, before=${beforeText}`);
    }

    let totalDownloaded = 0;
    let totalSkipped = 0;
    const onTrackDownloaded: DownloadedTrackHook | undefined =
      typeof options.onTrackDownloaded === "function" ? options.onTrackDownloaded : undefined;

  for (const workspace of targetWorkspaces) {
    console.log(`\nProcessing workspace: ${workspace.name}`);
    const tracks = await client.getTracks(workspace.id);
    for (const track of tracks) {
      await metadataStore.upsertSongWorkspace(track.id, workspace, "discovery");
    }
    console.log(`Found ${tracks.length} track(s)`);

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];

      if (!isTrackInDateWindow(track, createdAfter, createdBefore)) {
        console.log(`Skipping out-of-range track: ${track.title || track.id}`);
        totalSkipped++;
        continue;
      }

      if (track.status !== "complete" || !track.audio_url) {
        console.log(`Skipping incomplete track: ${track.title || track.id}`);
        totalSkipped++;
        continue;
      }

      const existingEntry = await metadataStore.getByClipId(track.id);
      if (existingEntry) {
        if (!existingEntry.rawApiResponse) {
          console.log(`Updating metadata for: ${track.title || track.id}`);
          const metadata = await client.fetchTrackMetadata(track.id);
          existingEntry.rawApiResponse = metadata.fullData as ISunoTrackResponse;
          await metadataStore.upsert(existingEntry);
          fs.writeFileSync(
            path.join(metadataDir, `${track.id}.json`),
            JSON.stringify(normalizeMetadata(existingEntry), null, 2),
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          console.log(`Already downloaded: ${(track.title??"-")} : ${track.id}`);
        }
        totalSkipped++;
        continue;
      }

      const audioDir = options.format === "wav" ? wavDir : mp3Dir;
      const filename = `${track.id}.${options.format}`;
      const filepath = path.join(audioDir, filename);
      console.log(`Downloading (${i + 1}/${tracks.length}): ${(track.title??"-")} : ${track.id}`);

      try {
        const metadata = await client.fetchTrackMetadata(track.id);

        if (options.format === "wav") {
          await client.downloadWav(track.id, filepath, false);
        } else {
          await client.downloadMp3(track.audio_url, filepath, track.id, false);
        }

        const imageUrl = getPreferredImageUrl(metadata);
        if (imageUrl) {
          const imageExt = path.extname(imageUrl) || ".jpeg";
          const imagePath = path.join(imagesDir, `${track.id}${imageExt}`);
          try {
            await client.downloadImage(imageUrl, imagePath, track.id);
          } catch (err) {
            console.warn(`Failed to download image: ${err}`);
          }
        }

        const songEntry: ISongData = {
          title: track.title || "Untitled",
          clipId: track.id,
          songUrl: `https://suno.com/song/${track.id}`,
          style: null,
          thumbnail: null,
          model: null,
          duration: null,
          liked: false,
          mp3Status: options.format === "mp3" ? "DOWNLOADED" : "PENDING",
          wavStatus: options.format === "wav" ? "DOWNLOADED" : "PENDING",
          alacStatus: "PENDING",
          flacStatus: "PENDING",
          artistName: null,
          lyrics: metadata.lyrics || undefined,
          creationDate: null,
          weirdness: null,
          styleStrength: null,
          audioStrength: null,
          remixParent: undefined,
          tags: [],
          rawApiResponse: metadata.fullData as ISunoTrackResponse,
          mp3Timestamp: options.format === "mp3" ? new Date() : null,
          wavTimestamp: options.format === "wav" ? new Date() : null,
          alacTimestamp: null,
          flacTimestamp: null,
        };

        const normalizedEntry = normalizeMetadata(songEntry);
        await metadataStore.upsert(normalizedEntry);
        fs.writeFileSync(
          path.join(metadataDir, `${track.id}.json`),
          JSON.stringify(normalizedEntry, null, 2),
        );

        console.log(`Saved: ${filename}`);
        totalDownloaded++;
        if (onTrackDownloaded) {
          try {
            onTrackDownloaded({ clipId: track.id, outputDir });
          } catch (hookError) {
            console.warn(`Download hook failed for ${track.id}: ${hookError}`);
          }
        }
      } catch (error) {
        console.error(
          `Failed to download ${track.title || track.id}:`,
          error instanceof Error ? error.message : error,
        );
        totalSkipped++;
      }

      if (i < tracks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  console.log(`\nDownload complete! Downloaded: ${totalDownloaded}, Skipped: ${totalSkipped}`);
  await exportMetadataJsonIfRequested(options, storeConfig, metadataJsonPath);
  return { outputDir, downloaded: totalDownloaded, skipped: totalSkipped };
  } finally {
    await metadataStore.close();
  }
}

async function runProcessWorkflow(options: CliOptions): Promise<void> {
  const outputDir = path.resolve(options.output);
  const storeConfig = resolveMetadataStoreOptions(options);
  await importMetadataJsonIfRequested(options, storeConfig);
  await runConverter({
    input: options.input,
    output: outputDir,
    metadataDatabaseType: storeConfig.type,
    metadataDatabase: storeConfig.sqlitePath,
    metadataPostgresUrl: storeConfig.postgresUrl,
    metadataFile: resolveMetadataFilePath(outputDir, options),
    copySongsMetadataToOutput: shouldCopySongsMetadataToOutput(options),
    processFormats: options.processFormats,
    processBitrate: options.processBitrate,
    processConcurrency: options.processConcurrency,
    processUpdateConcurrency: options.processUpdateConcurrency,
    images: options.images,
    lyrics: options.lyrics,
    exitOnError: options.exitOnError,
    reconvertBefore: options.reconvertBefore,
    reconvertAfter: options.reconvertAfter,
    reconvertMissing: options.reconvertMissing,
    processClipIds: options.processClipIds,
  });
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
  const client = await getAuthenticatedClient(options);
  const outputDir = path.resolve(options.output);
  const storeConfig = resolveMetadataStoreOptions(options);
  const metadataJsonPath = resolveMetadataJsonExportPath(outputDir, options);
  await importMetadataJsonIfRequested(options, storeConfig);
  const imagesDir = path.join(outputDir, "images");
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

  let entries: Array<{ clipId: string; thumbnail: string | null }> = [];
  const hasListPath = typeof options.list === "string" && options.list.trim().length > 0;
  const wantsFetchedList = typeof options.fetchImageList === "string" && options.fetchImageList.trim().length > 0;
  const fetchMissing = options.fetchMissing === true;

  if (!hasListPath && !wantsFetchedList && !fetchMissing) {
    throw new Error("download-images requires one of: --list, --fetch-image-list, or --fetch-missing");
  }
  if (hasListPath && wantsFetchedList) {
    throw new Error("--list cannot be combined with --fetch-image-list");
  }

  if (hasListPath) {
    const listPath = path.resolve(options.list);
    if (!fs.existsSync(listPath)) {
      throw new Error(`Image list file not found: ${listPath}`);
    }
    try {
      entries = JSON.parse(fs.readFileSync(listPath, "utf-8"));
    } catch (err) {
      throw new Error(`Failed to parse image list: ${err}`);
    }
  } else {
    entries = await getImagesNeedingDownload(outputDir, storeConfig);
    console.log(`Found ${entries.length} image(s) needing download`);

    if (wantsFetchedList) {
      const outFile = path.resolve(options.fetchImageList);
      fs.writeFileSync(outFile, JSON.stringify(entries, null, 2));
      console.log(`Wrote ${entries.length} images to ${outFile}`);
    }

    if (!fetchMissing) {
      return;
    }
  }

  if (entries.length === 0) {
    console.log("No images to download.");
    return;
  }

  for (let i = 0; i < entries.length; i++) {
    const { clipId, thumbnail } = entries[i];
    if (!thumbnail) continue;

    let preferredImageUrl = thumbnail;
    try {
      const metadata = await client.fetchTrackMetadata(clipId);
      preferredImageUrl = getPreferredImageUrl(metadata, thumbnail) || thumbnail;
    } catch (err) {
      console.warn(`Failed to refresh metadata for ${clipId}, using list thumbnail: ${err}`);
    }

    const ext = path.extname(preferredImageUrl) || ".jpeg";
    const imagePath = path.join(imagesDir, `${clipId}${ext}`);
    console.log(`Downloading image ${i + 1}/${entries.length}: ${clipId}`);

    try {
      await client.downloadImage(preferredImageUrl, imagePath, clipId);
    } catch (err) {
      console.warn(`Failed downloading ${clipId}: ${err}`);
    }

    if (i < entries.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, parseInt(options.delay, 10)));
    }
  }

  await exportMetadataJsonIfRequested(options, storeConfig, metadataJsonPath);
}

export async function runListFlow(options: CliOptions): Promise<void> {
  const client = await getAuthenticatedClient(options);
  const workspaces = await client.getWorkspaces();
  await saveWorkspacesToDatabase(options, workspaces);
  const targetWorkspaces = filterWorkspaces(workspaces, options.workspace);

  if (options.json) {
    const result: Record<string, any> = {};
    for (const workspace of targetWorkspaces) {
      const tracks = await client.getTracks(workspace.id);
      await saveTrackWorkspaceLinks(
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
    await saveTrackWorkspaceLinks(
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
  const client = await getAuthenticatedClient(options);
  const workspaces = await client.getWorkspaces();
  await saveWorkspacesToDatabase(options, workspaces);

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
  const client = await getAuthenticatedClient(options);
  const metadata = await client.fetchTrackMetadata(trackId);
  console.log(JSON.stringify(metadata, null, 2));
}

async function runFetchMetadataWorkflow(options: CliOptions): Promise<void> {
  const client = await getAuthenticatedClient(options);
  const explicitIds = parseTrackIdsOption(options.ids);
  const { createdAfter, createdBefore } = getCreatedAtFilters(options);

  if (
    explicitIds.length > 0 &&
    (options.workspace || createdAfter || createdBefore)
  ) {
    throw new Error(
      "--ids cannot be combined with --workspace, --created-after, or --created-before",
    );
  }

  if (explicitIds.length > 0) {
    console.log(`Fetching metadata for ${explicitIds.length} tracks from --ids...`);
    await client.fetchAllTracksMetadata(explicitIds, (current, total) => {
      const percent = Math.round((current / total) * 100);
      process.stdout.write(`\rProgress: ${current}/${total} (${percent}%)`);
    });
    console.log("\nMetadata fetch complete!");
    return;
  }

  const workspaces = await client.getWorkspaces();
  await saveWorkspacesToDatabase(options, workspaces);
  const targetWorkspaces = filterWorkspaces(workspaces, options.workspace);

  const allTrackIds: string[] = [];
  for (const workspace of targetWorkspaces) {
    const tracks = await client.getTracks(workspace.id);
    await saveTrackWorkspaceLinks(
      options,
      workspace,
      tracks.map((track) => track.id),
    );
    const filteredTracks = tracks.filter((t) => isTrackInDateWindow(t, createdAfter, createdBefore));
    allTrackIds.push(...filteredTracks.map((t) => t.id));
  }

  if (allTrackIds.length === 0) {
    console.log("No tracks matched the selection criteria; nothing to fetch.");
    return;
  }

  console.log(`Fetching metadata for ${allTrackIds.length} tracks...`);

  await client.fetchAllTracksMetadata(allTrackIds, (current, total) => {
    const percent = Math.round((current / total) * 100);
    process.stdout.write(`\rProgress: ${current}/${total} (${percent}%)`);
  });

  console.log("\nMetadata fetch complete!");
}

async function runRefreshWorkflow(options: CliOptions): Promise<void> {
  const client = await getAuthenticatedClient(options);
  console.log("Refreshing all workspaces...");
  const workspaces = await client.refreshAllWorkspaces();
  await saveWorkspacesToDatabase(options, workspaces);
  console.log(`Refreshed ${workspaces.length} workspace(s)`);
}

export async function runDownloadFlow(options: CliOptions): Promise<DownloadFlowResult> {
  const { result } = await runLocalWorkflowCommand("download", options, [
    { type: "authorization", workerRole: "auth" },
    { type: "asset-acquisition", workerRole: "asset" },
    { type: "finalization", workerRole: "orchestrator" },
  ], async ({ runStage }) => {
    const client = await runStage("authorization", async () => getAuthenticatedClient(options));
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
    const client = await runStage("authorization", async () => getAuthenticatedClient(options));
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
    const client = await runStage("authorization", async () => getAuthenticatedClient(options));
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
    const client = await runStage("authorization", async () => getAuthenticatedClient(options));
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
    const client = await runStage("authorization", async () => getAuthenticatedClient(options));
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
