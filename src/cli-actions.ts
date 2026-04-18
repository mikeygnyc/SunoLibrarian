import * as fs from "fs";
import * as path from "path";
import { extractTokenFromBrowser } from "./auth";
import { SunoClient } from "./client";
import { runConverter } from "./converter";
import { Processor } from "./library-processor";
import { normalizeMetadata } from "./lib/metadata/normalize-metadata";
import { AudioFormat, ISongData, ISunoTrackResponse, IWorkspace } from "./lib/interfaces";
import { Storage } from "./storage";
import {
  exportMetadataDatabaseToJson,
  importMetadataJsonToDatabase,
  resolveDatabasePath,
  SqliteMetadataStore,
} from "./metadata-store";

type CliOptions = Record<string, any>;
const DEFAULT_BROWSER_ENDPOINT = "http://localhost:9222";
const DEFAULT_METADATA_FILENAME = "songs_metadata.json";

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

function resolveMetadataDatabasePath(options: CliOptions): string {
  return resolveDatabasePath(typeof options.database === "string" ? options.database : undefined);
}

async function importMetadataJsonIfRequested(options: CliOptions, databasePath: string): Promise<void> {
  if (typeof options.importMetadataJson !== "string" || options.importMetadataJson.trim().length === 0) {
    return;
  }
  const result = await importMetadataJsonToDatabase(options.importMetadataJson, databasePath);
  console.log(`Imported ${result.imported} metadata entr${result.imported === 1 ? "y" : "ies"} to ${result.databasePath}`);
}

async function exportMetadataJsonIfRequested(
  options: CliOptions,
  databasePath: string,
  fallbackJsonPath: string,
): Promise<void> {
  const shouldExport = typeof options.exportMetadataJson === "string" && options.exportMetadataJson.trim().length > 0;
  if (!shouldExport && !shouldCopySongsMetadataToOutput(options)) return;

  const jsonPath = shouldExport
    ? path.resolve(options.exportMetadataJson.trim())
    : fallbackJsonPath;
  const result = await exportMetadataDatabaseToJson(jsonPath, databasePath);
  console.log(`Exported ${result.exported} metadata entr${result.exported === 1 ? "y" : "ies"} to ${result.jsonFilePath}`);
}

async function getImagesNeedingDownload(
  rootDir: string,
  databasePath?: string,
): Promise<Array<{ clipId: string; thumbnail: string | null }>> {
  const processor = new Processor({
    inputRoot: rootDir,
    outputRoot: rootDir,
    metadataDatabasePath: databasePath,
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

export async function runDownloadFlow(options: CliOptions): Promise<DownloadFlowResult> {
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

  const databasePath = resolveMetadataDatabasePath(options);
  const metadataJsonPath = resolveMetadataJsonExportPath(outputDir, options);
  await importMetadataJsonIfRequested(options, databasePath);
  const metadataStore = new SqliteMetadataStore(databasePath);
  let songsMetadata = await metadataStore.loadAll();
  songsMetadata = songsMetadata.map((entry) => normalizeMetadata(entry));
  await metadataStore.saveAll(songsMetadata);
  console.log(`Metadata database: ${metadataStore.location}`);

  try {
  console.log("Fetching workspaces...");
  const workspaces = await client.getWorkspaces();
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

      const existingEntry = songsMetadata.find((m) => m.clipId === track.id);
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
          console.log(`Already downloaded: ${track.title || track.id}`);
        }
        totalSkipped++;
        continue;
      }

      const audioDir = options.format === "wav" ? wavDir : mp3Dir;
      const filename = `${track.id}.${options.format}`;
      const filepath = path.join(audioDir, filename);
      console.log(`Downloading (${i + 1}/${tracks.length}): ${track.title || track.id}`);

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
        songsMetadata.push(normalizedEntry);
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
  await exportMetadataJsonIfRequested(options, databasePath, metadataJsonPath);
  return { outputDir, downloaded: totalDownloaded, skipped: totalSkipped };
  } finally {
    metadataStore.close();
  }
}

export async function runProcessFlow(options: CliOptions): Promise<void> {
  const outputDir = path.resolve(options.output);
  const databasePath = resolveMetadataDatabasePath(options);
  await importMetadataJsonIfRequested(options, databasePath);
  await runConverter({
    input: options.input,
    output: outputDir,
    metadataDatabase: databasePath,
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
    databasePath,
    resolveMetadataJsonExportPath(outputDir, options),
  );
}

export async function runClearAuthTokenFlow(): Promise<void> {
  const storage = new Storage();
  storage.clearAuthToken();
  console.log("Cached authentication token cleared.");
}

export async function runImportMetadataJsonFlow(options: CliOptions): Promise<void> {
  const databasePath = resolveMetadataDatabasePath(options);
  const result = await importMetadataJsonToDatabase(options.input, databasePath);
  console.log(`Imported ${result.imported} metadata entr${result.imported === 1 ? "y" : "ies"} to ${result.databasePath}`);
}

export async function runExportMetadataJsonFlow(options: CliOptions): Promise<void> {
  const databasePath = resolveMetadataDatabasePath(options);
  const result = await exportMetadataDatabaseToJson(options.output, databasePath);
  console.log(`Exported ${result.exported} metadata entr${result.exported === 1 ? "y" : "ies"} to ${result.jsonFilePath}`);
}

export async function runSyncFlow(options: CliOptions): Promise<void> {
  const outputDir = path.resolve(options.output);
  const conversionOutput = options.library || outputDir;
  const databasePath = resolveMetadataDatabasePath(options);
  const metadataJsonPath = resolveMetadataJsonExportPath(outputDir, options);
  const processDownloadedOnly = options.processDownloadedOnly === true;
  const downloadedClipIds = new Set<string>();
  let conversionChain: Promise<void> = Promise.resolve();
  let queuedConversions = 0;
  let conversionFailed: Error | null = null;

  const queueConversion = (): void => {
    queuedConversions++;
    conversionChain = conversionChain.then(async () => {
      if (conversionFailed) return;
      await runProcessFlow({
        input: outputDir,
        output: conversionOutput,
        database: databasePath,
        copySongsMetadataToOutput: false,
        processFormats: options.processFormats,
        processBitrate: options.processBitrate,
        processConcurrency: options.processConcurrency,
        processUpdateConcurrency: options.processUpdateConcurrency,
        images: options.images,
        lyrics: options.lyrics,
        exitOnError: options.exitOnError,
        processClipIds: processDownloadedOnly ? Array.from(downloadedClipIds) : undefined,
      });
    }).catch((err: any) => {
      const wrapped = err instanceof Error ? err : new Error(String(err));
      conversionFailed = wrapped;
      if (!options.exitOnError) {
        console.error(`Conversion run failed during sync: ${wrapped.message}`);
      }
    });
  };

  const downloadResult = await runDownloadFlow({
    ...options,
    output: outputDir,
    database: databasePath,
    exportMetadataJson: undefined,
    copySongsMetadataToOutput: false,
    onTrackDownloaded: ({ clipId }: { clipId: string }) => {
      downloadedClipIds.add(clipId);
      queueConversion();
    },
  });

  if (!processDownloadedOnly && queuedConversions === 0 && downloadResult.downloaded > 0) {
    queueConversion();
  }

  await conversionChain;
  if (conversionFailed) {
    throw conversionFailed;
  }
  await exportMetadataJsonIfRequested(options, databasePath, metadataJsonPath);
}

export async function runDownloadImagesFlow(options: CliOptions): Promise<void> {
  const client = await getAuthenticatedClient(options);
  const outputDir = path.resolve(options.output);
  const databasePath = resolveMetadataDatabasePath(options);
  const metadataJsonPath = resolveMetadataJsonExportPath(outputDir, options);
  await importMetadataJsonIfRequested(options, databasePath);
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
    entries = await getImagesNeedingDownload(outputDir, databasePath);
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

  await exportMetadataJsonIfRequested(options, databasePath, metadataJsonPath);
}

export async function runListFlow(options: CliOptions): Promise<void> {
  const client = await getAuthenticatedClient(options);
  const workspaces = await client.getWorkspaces();
  const targetWorkspaces = filterWorkspaces(workspaces, options.workspace);

  if (options.json) {
    const result: Record<string, any> = {};
    for (const workspace of targetWorkspaces) {
      const tracks = await client.getTracks(workspace.id);
      result[workspace.name] = tracks;
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  for (const workspace of targetWorkspaces) {
    console.log(`\n=== ${workspace.name} ===`);
    const tracks = await client.getTracks(workspace.id);
    tracks.forEach((track) => {
      console.log(`  ${track.id} - ${track.title || "(Untitled)"} [${track.status}]`);
    });
  }
}

export async function runWorkspacesFlow(options: CliOptions): Promise<void> {
  const client = await getAuthenticatedClient(options);
  const workspaces = await client.getWorkspaces();

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

export async function runFetchMetadataFlow(options: CliOptions): Promise<void> {
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
  const targetWorkspaces = filterWorkspaces(workspaces, options.workspace);

  const allTrackIds: string[] = [];
  for (const workspace of targetWorkspaces) {
    const tracks = await client.getTracks(workspace.id);
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

export async function runRefreshFlow(options: CliOptions): Promise<void> {
  const client = await getAuthenticatedClient(options);
  console.log("Refreshing all workspaces...");
  const workspaces = await client.refreshAllWorkspaces();
  console.log(`Refreshed ${workspaces.length} workspace(s)`);
}
