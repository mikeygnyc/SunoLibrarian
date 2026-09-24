import * as fs from "fs";
import * as path from "path";
import { assertNotCancelled } from "../cancellation";
import { Processor } from "../library-processor";
import { createMetadataStore, describeMetadataStoreConfig, type MetadataStoreConfig } from "../metadata-store";
import { normalizeMetadata } from "../lib/metadata/normalize-metadata";
import type { AudioFormat, ISongData, ISunoTrackResponse } from "../lib/interfaces";
import type { SunoClient } from "../client";
import type { CliOptions } from "./auth-service";
import { filterWorkspaces, getCreatedAtFilters, isTrackInDateWindow } from "./metadata-acquisition-service";

export type DownloadFlowResult = {
  outputDir: string;
  downloaded: number;
  skipped: number;
  downloadedClipIds: string[];
};

export type DownloadedTrackHook = (params: {
  clipId: string;
  outputDir: string;
}) => void | Promise<void>;

type ResolveMetadataStoreOptions = (options: CliOptions) => MetadataStoreConfig;
type ImportMetadataJsonIfRequested = (options: CliOptions, storeConfig: MetadataStoreConfig) => Promise<void>;
type ExportMetadataJsonIfRequested = (
  options: CliOptions,
  storeConfig: MetadataStoreConfig,
  fallbackJsonPath: string,
) => Promise<void>;
type ResolveMetadataJsonExportPath = (rootDir: string, options: CliOptions) => string;

let resolveMetadataStoreOptions: ResolveMetadataStoreOptions;
let importMetadataJsonIfRequested: ImportMetadataJsonIfRequested;
let exportMetadataJsonIfRequested: ExportMetadataJsonIfRequested;
let resolveMetadataJsonExportPath: ResolveMetadataJsonExportPath;

export class AssetAcquisitionService {
  async downloadTracks(options: CliOptions, client: SunoClient): Promise<DownloadFlowResult> {
    await assertNotCancelled(options);
    const { createdAfter, createdBefore } = getCreatedAtFilters(options);

    if (options.flushCache) {
      console.log("Flushing cache...");
      options.__storage?.clearCache?.();
    }

    const outputDir = path.resolve(String(options.output));
    const delay = parseInt(String(options.delay), 10);

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
    console.log(`Metadata store: ${describeMetadataStoreConfig(storeConfig)}`);
    console.log("Using targeted metadata lookups from the metadata store");

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
      const downloadedClipIds: string[] = [];
      const onTrackDownloaded: DownloadedTrackHook | undefined =
        typeof options.onTrackDownloaded === "function" ? options.onTrackDownloaded : undefined;
      const requestedClipIds = Array.isArray(options.downloadClipIds)
        ? new Set(
          options.downloadClipIds
            .filter((clipId): clipId is string => typeof clipId === "string")
            .map((clipId) => clipId.trim())
            .filter((clipId) => clipId.length > 0),
        )
        : null;

      for (const workspace of targetWorkspaces) {
        await assertNotCancelled(options);
        console.log(`\nProcessing workspace: ${workspace.name}`);
        const tracks = await client.getTracks(workspace.id);
        for (const track of tracks) {
          await metadataStore.upsertSongWorkspace(track.id, workspace, "discovery");
        }
        const candidateTracks = requestedClipIds
          ? tracks.filter((track) => requestedClipIds.has(track.id))
          : tracks;
        console.log(`Found ${candidateTracks.length} track(s)`);
        const downloadVerifications = await metadataStore.loadDownloadVerifications(
          candidateTracks.map((track) => track.id),
        );
        const downloadVerificationByClipId = new Map(
          downloadVerifications.map((verification) => [verification.clipId, verification]),
        );

        for (let i = 0; i < candidateTracks.length; i++) {
          await assertNotCancelled(options);
          const track = candidateTracks[i];
          const targetStatusKey = options.format === "wav" ? "wavStatus" : "mp3Status";
          const targetTimestampKey = options.format === "wav" ? "wavTimestamp" : "mp3Timestamp";

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

          const downloadVerification = downloadVerificationByClipId.get(track.id);
          let existingEntry: ISongData | undefined;
          if (downloadVerification) {
            if (!downloadVerification.hasRawApiResponse) {
              existingEntry = await metadataStore.getByClipId(track.id);
              if (existingEntry) {
                console.log(`Updating metadata for: ${track.title || track.id}`);
                const metadata = await client.fetchTrackMetadata(track.id);
                existingEntry.rawApiResponse = metadata.fullData as ISunoTrackResponse;
                await metadataStore.upsert(existingEntry);
                fs.writeFileSync(
                  path.join(metadataDir, `${track.id}.json`),
                  JSON.stringify(normalizeMetadata(existingEntry), null, 2),
                );
                await sleep(delay);
              }
            }

            if (downloadVerification[targetStatusKey] === "DOWNLOADED") {
              console.log(`Already downloaded: ${(track.title ?? "-")} : ${track.id}`);
              totalSkipped++;
              continue;
            }

            existingEntry ??= await metadataStore.getByClipId(track.id);
          }

          const audioDir = options.format === "wav" ? wavDir : mp3Dir;
          const filename = `${track.id}.${options.format}`;
          const filepath = path.join(audioDir, filename);
          console.log(`Downloading (${i + 1}/${candidateTracks.length}): ${(track.title ?? "-")} : ${track.id}`);

          try {
            await assertNotCancelled(options);
            const metadata = await client.fetchTrackMetadata(track.id);

            if (options.format === "wav") {
              await assertNotCancelled(options);
              await client.downloadWav(track.id, filepath, false);
            } else {
              await assertNotCancelled(options);
              await client.downloadMp3(track.audio_url, filepath, track.id, false);
            }

            const imageUrl = getPreferredImageUrl(metadata);
            if (imageUrl) {
              const imageExt = path.extname(imageUrl) || ".jpeg";
              const imagePath = path.join(imagesDir, `${track.id}${imageExt}`);
              try {
                await assertNotCancelled(options);
                await client.downloadImage(imageUrl, imagePath, track.id);
              } catch (err) {
                console.warn(`Failed to download image: ${err}`);
              }
            }

            const updatedAt = new Date();
            const songEntry: ISongData = existingEntry
              ? {
                  ...existingEntry,
                  rawApiResponse: metadata.fullData as ISunoTrackResponse,
                  [targetStatusKey]: "DOWNLOADED",
                  [targetTimestampKey]: updatedAt,
                }
              : {
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
                  mp3Timestamp: options.format === "mp3" ? updatedAt : null,
                  wavTimestamp: options.format === "wav" ? updatedAt : null,
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
            downloadedClipIds.push(track.id);
            if (onTrackDownloaded) {
              try {
                await onTrackDownloaded({ clipId: track.id, outputDir });
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

          if (i < candidateTracks.length - 1) {
            await assertNotCancelled(options);
            await sleep(delay);
          }
        }
      }

      console.log(`\nDownload complete! Downloaded: ${totalDownloaded}, Skipped: ${totalSkipped}`);
      await assertNotCancelled(options);
      await exportMetadataJsonIfRequested(options, storeConfig, metadataJsonPath);
      return { outputDir, downloaded: totalDownloaded, skipped: totalSkipped, downloadedClipIds };
    } finally {
      await metadataStore.close();
    }
  }

  async downloadImages(options: CliOptions, client: SunoClient): Promise<void> {
    await assertNotCancelled(options);
    const outputDir = path.resolve(String(options.output));
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
      const listPath = path.resolve(String(options.list));
      if (!fs.existsSync(listPath)) {
        throw new Error(`Image list file not found: ${listPath}`);
      }
      try {
        entries = JSON.parse(fs.readFileSync(listPath, "utf-8"));
      } catch (err) {
        throw new Error(`Failed to parse image list: ${err}`);
      }
    } else {
      entries = await this.getImagesNeedingDownload(outputDir, storeConfig);
      console.log(`Found ${entries.length} image(s) needing download`);

      if (wantsFetchedList) {
        const outFile = path.resolve(String(options.fetchImageList));
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
      await assertNotCancelled(options);
      const { clipId, thumbnail } = entries[i];
      if (!thumbnail) continue;

      let preferredImageUrl = thumbnail;
      try {
        await assertNotCancelled(options);
        const metadata = await client.fetchTrackMetadata(clipId);
        preferredImageUrl = getPreferredImageUrl(metadata, thumbnail) || thumbnail;
      } catch (err) {
        console.warn(`Failed to refresh metadata for ${clipId}, using list thumbnail: ${err}`);
      }

      const ext = path.extname(preferredImageUrl) || ".jpeg";
      const imagePath = path.join(imagesDir, `${clipId}${ext}`);
      console.log(`Downloading image ${i + 1}/${entries.length}: ${clipId}`);

      try {
        await assertNotCancelled(options);
        await client.downloadImage(preferredImageUrl, imagePath, clipId);
      } catch (err) {
        console.warn(`Failed downloading ${clipId}: ${err}`);
      }

      if (i < entries.length - 1) {
        await assertNotCancelled(options);
        await sleep(parseInt(String(options.delay), 10));
      }
    }

    await assertNotCancelled(options);
    await exportMetadataJsonIfRequested(options, storeConfig, metadataJsonPath);
  }

  private async getImagesNeedingDownload(
    rootDir: string,
    storeConfig?: MetadataStoreConfig,
  ): Promise<Array<{ clipId: string; thumbnail: string | null }>> {
    const processor = new Processor({
      inputRoot: rootDir,
      outputRoot: rootDir,
      metadataDatabaseType: storeConfig?.type,
      metadataDatabasePath: storeConfig?.sqlitePath ?? storeConfig?.jsonFilePath,
      metadataPostgresUrl: storeConfig?.postgresUrl,
      formats: ["flac", "mp3", "alac"] as AudioFormat[],
      mp3Bitrate: 320,
      embedImages: true,
      embedLyrics: true,
      exitOnError: false,
    });
    return processor.getImagesNeedingDownload();
  }
}

export function configureAssetAcquisitionService(deps: {
  resolveMetadataStoreOptions: ResolveMetadataStoreOptions,
  importMetadataJsonIfRequested: ImportMetadataJsonIfRequested,
  exportMetadataJsonIfRequested: ExportMetadataJsonIfRequested,
  resolveMetadataJsonExportPath: ResolveMetadataJsonExportPath,
}): void {
  resolveMetadataStoreOptions = deps.resolveMetadataStoreOptions;
  importMetadataJsonIfRequested = deps.importMetadataJsonIfRequested;
  exportMetadataJsonIfRequested = deps.exportMetadataJsonIfRequested;
  resolveMetadataJsonExportPath = deps.resolveMetadataJsonExportPath;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
