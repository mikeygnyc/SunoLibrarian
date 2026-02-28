#!/usr/bin/env node
import { Command } from "commander";
import { SunoClient } from "./client";
import { extractTokenFromBrowser } from "./auth";
import { SunoTrackResponse, ISongData } from "./lib/interfaces";
import { Storage } from "./storage";
import { normalizeMetadata } from "./lib/metadata/normalize-metadata";
import * as fs from "fs";
import * as path from "path";
import { runConverter } from "./converter";

const program = new Command();

program
  .name("suno-export")
  .description("CLI tool to export Suno tracks")
  .version("1.0.0");

async function getAuthenticatedClient(options: any): Promise<SunoClient> {
  let token = options.token;
  if (!token) {
    console.log("No token provided. Launching browser to extract token...");
    token = await extractTokenFromBrowser(options.browser);
    console.log("Token extracted successfully!");
  }
  return new SunoClient(token, undefined, options.browser);
}

function filterWorkspaces(workspaces: any[], workspaceId?: string) {
  return workspaceId
    ? workspaces.filter((w) => w.id === workspaceId)
    : workspaces;
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

async function runDownloadFlow(options: any): Promise<{ outputDir: string; downloaded: number; skipped: number }> {
  const client = await getAuthenticatedClient(options);

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

  const metadataFile = path.join(outputDir, "songs_metadata.json");
  let songsMetadata: any[] = [];
  if (fs.existsSync(metadataFile)) {
    try {
      const content = fs.readFileSync(metadataFile, "utf-8");
      if (content.trim()) {
        const parsed = JSON.parse(content);
        songsMetadata = Array.isArray(parsed) ? parsed : [];
      }
    } catch {
      console.warn("Failed to parse existing metadata file, starting fresh");
    }
  }

  songsMetadata = songsMetadata.map((e) => normalizeMetadata(e));
  try {
    const tmp = `${metadataFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(songsMetadata, null, 2));
    fs.renameSync(tmp, metadataFile);
  } catch (err: any) {
    console.warn(`Failed to initialize metadata file: ${err.message || err}`);
  }

  console.log("Fetching workspaces...");
  const workspaces = await client.getWorkspaces();
  console.log(`Found ${workspaces.length} workspace(s)`);

  const targetWorkspaces = filterWorkspaces(workspaces, options.workspace);
  if (targetWorkspaces.length === 0) {
    throw new Error("No matching workspaces found");
  }

  let totalDownloaded = 0;
  let totalSkipped = 0;

  for (const workspace of targetWorkspaces) {
    console.log(`\nProcessing workspace: ${workspace.name}`);
    const tracks = await client.getTracks(workspace.id);
    console.log(`Found ${tracks.length} track(s)`);

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];

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
          existingEntry.rawApiResponse = metadata.fullData as SunoTrackResponse;
          fs.writeFileSync(metadataFile, JSON.stringify(songsMetadata, null, 2));
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
          rawApiResponse: metadata.fullData as SunoTrackResponse,
          mp3Timestamp: options.format === "mp3" ? new Date() : null,
          wavTimestamp: options.format === "wav" ? new Date() : null,
          alacTimestamp: null,
          flacTimestamp: null,
        };

        const normalizedEntry = normalizeMetadata(songEntry);
        songsMetadata.push(normalizedEntry);
        fs.writeFileSync(metadataFile, JSON.stringify(songsMetadata, null, 2));
        fs.writeFileSync(
          path.join(metadataDir, `${track.id}.json`),
          JSON.stringify(normalizedEntry, null, 2),
        );

        console.log(`Saved: ${filename}`);
        totalDownloaded++;
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
  return { outputDir, downloaded: totalDownloaded, skipped: totalSkipped };
}

async function runProcessFlow(options: any): Promise<void> {
  await runConverter({
    input: options.input,
    output: options.output,
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
    imageList: options.imageList,
  });
}

async function runSyncFlow(options: any): Promise<void> {
  const downloadResult = await runDownloadFlow(options);
  await runProcessFlow({
    input: downloadResult.outputDir,
    output: options.library || downloadResult.outputDir,
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
  });
}

program
  .command("download")
  .description("Download tracks from Suno")
  .option("-t, --token <token>", "Authentication token")
  .option(
    "-b, --browser <url>",
    "Connect to existing Chrome instance (e.g., http://localhost:9222)",
  )
  .option("-w, --workspace <id>", "Workspace ID (default: all workspaces)")
  .option("-f, --format <format>", "Download format: mp3 or wav", "mp3")
  .option("-o, --output <dir>", "Output directory", "./downloads")
  .option("--no-metadata", "Skip metadata sidecar files")
  .option("--delay <ms>", "Delay between downloads in ms", "1000")
  .option("--flush-cache", "Clear cache before starting")
  .action(async (options) => {
    try {
      await runDownloadFlow(options);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command("sync")
  .description("Download tracks, then run converter in one chained workflow")
  .option("-t, --token <token>", "Authentication token")
  .option(
    "-b, --browser <url>",
    "Connect to existing Chrome instance (e.g., http://localhost:9222)",
  )
  .option("-w, --workspace <id>", "Workspace ID (default: all workspaces)")
  .option("-f, --format <format>", "Download format: mp3 or wav", "mp3")
  .option("-o, --output <dir>", "Download/output directory for source files", "./downloads")
  .option("--delay <ms>", "Delay between downloads in ms", "1000")
  .option("--flush-cache", "Clear cache before starting")
  .option("--library <dir>", "Final converted library output (default: same as --output)")
  .option("--process-formats <formats>", "Converter formats", "flac,mp3,alac")
  .option("--process-bitrate <kbps>", "Converter MP3 bitrate", "320")
  .option("--process-concurrency <n>", "Converter processing concurrency", "4")
  .option("--process-update-concurrency <n>", "Converter update concurrency", "8")
  .option("--no-images", "Skip embedding images during conversion")
  .option("--no-lyrics", "Skip embedding lyrics during conversion")
  .option("--exit-on-error", "Exit immediately on conversion errors")
  .option("--reconvert-before <iso>", "Converter reconvert-before filter")
  .option("--reconvert-after <iso>", "Converter reconvert-after filter")
  .option("--reconvert-missing", "Converter reconvert only missing files")
  .action(async (options) => {
    try {
      await runSyncFlow(options);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command("process")
  .description("Run audio conversion/metadata embedding (converter functionality)")
  .requiredOption("-i, --input <path>", "Input root directory")
  .requiredOption("-o, --output <path>", "Output root directory")
  .option("--process-formats <formats>", "Audio formats", "flac,mp3,alac")
  .option("--process-bitrate <kbps>", "MP3 bitrate", "320")
  .option("--process-concurrency <n>", "Processing concurrency", "4")
  .option("--process-update-concurrency <n>", "Update concurrency", "8")
  .option("--no-images", "Skip embedding images")
  .option("--no-lyrics", "Skip embedding lyrics")
  .option("--exit-on-error", "Exit on processing error")
  .option("--reconvert-before <iso>", "Only reconvert on/before date")
  .option("--reconvert-after <iso>", "Only reconvert on/after date")
  .option("--reconvert-missing", "Only process missing formats")
  .option("--image-list <file>", "Write JSON list of tracks whose images need downloading")
  .action(async (options) => {
    try {
      await runProcessFlow(options);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command("download-images")
  .description("Download artwork for tracks listed in a JSON file")
  .requiredOption("-l, --list <file>", "JSON file containing clipId/thumbnail objects")
  .option("-t, --token <token>", "Authentication token")
  .option(
    "-b, --browser <url>",
    "Connect to existing Chrome instance (e.g., http://localhost:9222)",
  )
  .option("-o, --output <dir>", "Output directory", "./downloads")
  .option("--delay <ms>", "Delay between downloads in ms", "1000")
  .action(async (options) => {
    try {
      const client = await getAuthenticatedClient(options);
      const outputDir = path.resolve(options.output);
      const imagesDir = path.join(outputDir, "images");
      if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

      const listPath = path.resolve(options.list);
      if (!fs.existsSync(listPath)) {
        console.error("Image list file not found: " + listPath);
        process.exit(1);
      }
      let entries: Array<{ clipId: string; thumbnail: string | null }> = [];
      try {
        entries = JSON.parse(fs.readFileSync(listPath, "utf-8"));
      } catch (err) {
        console.error("Failed to parse image list:", err);
        process.exit(1);
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
          await new Promise(r => setTimeout(r, parseInt(options.delay)));
        }
      }
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command("list")
  .description("List all tracks")
  .option("-t, --token <token>", "Authentication token")
  .option(
    "-b, --browser <url>",
    "Connect to existing Chrome instance (e.g., http://localhost:9222)",
  )
  .option("-w, --workspace <id>", "Workspace ID (default: all workspaces)")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    try {
      const client = await getAuthenticatedClient(options);
      const workspaces = await client.getWorkspaces();
      const targetWorkspaces = filterWorkspaces(workspaces, options.workspace);

      if (options.json) {
        const result: any = {};
        for (const workspace of targetWorkspaces) {
          const tracks = await client.getTracks(workspace.id);
          result[workspace.name] = tracks;
        }
        console.log(JSON.stringify(result, null, 2));
      } else {
        for (const workspace of targetWorkspaces) {
          console.log(`\n=== ${workspace.name} ===`);
          const tracks = await client.getTracks(workspace.id);
          tracks.forEach((track) => {
            console.log(
              `  ${track.id} - ${track.title || "(Untitled)"} [${track.status}]`,
            );
          });
        }
      }
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command("workspaces")
  .description("List all workspaces")
  .option("-t, --token <token>", "Authentication token")
  .option(
    "-b, --browser <url>",
    "Connect to existing Chrome instance (e.g., http://localhost:9222)",
  )
  .option("--json", "Output as JSON")
  .action(async (options) => {
    try {
      const client = await getAuthenticatedClient(options);
      const workspaces = await client.getWorkspaces();

      if (options.json) {
        console.log(JSON.stringify(workspaces, null, 2));
      } else {
        console.log(`\nFound ${workspaces.length} workspace(s):\n`);
        workspaces.forEach((workspace) => {
          console.log(`  ${workspace.id} - ${workspace.name}`);
        });
      }
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command("metadata <trackId>")
  .description("Fetch metadata for a specific track")
  .option("-t, --token <token>", "Authentication token")
  .option(
    "-b, --browser <url>",
    "Connect to existing Chrome instance (e.g., http://localhost:9222)",
  )
  .action(async (trackId, options) => {
    try {
      const client = await getAuthenticatedClient(options);
      const metadata = await client.fetchTrackMetadata(trackId);
      console.log(JSON.stringify(metadata, null, 2));
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command("fetch-metadata")
  .description("Fetch and cache metadata for all tracks")
  .option("-t, --token <token>", "Authentication token")
  .option(
    "-b, --browser <url>",
    "Connect to existing Chrome instance (e.g., http://localhost:9222)",
  )
  .option("-w, --workspace <id>", "Workspace ID (default: all workspaces)")
  .action(async (options) => {
    try {
      const client = await getAuthenticatedClient(options);
      const workspaces = await client.getWorkspaces();
      const targetWorkspaces = filterWorkspaces(workspaces, options.workspace);

      const allTrackIds: string[] = [];
      for (const workspace of targetWorkspaces) {
        const tracks = await client.getTracks(workspace.id);
        allTrackIds.push(...tracks.map((t) => t.id));
      }

      console.log(`Fetching metadata for ${allTrackIds.length} tracks...`);

      await client.fetchAllTracksMetadata(allTrackIds, (current, total) => {
        const percent = Math.round((current / total) * 100);
        process.stdout.write(`\rProgress: ${current}/${total} (${percent}%)`);
      });

      console.log("\nMetadata fetch complete!");
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command("refresh")
  .description("Refresh cached tracks for all workspaces")
  .option("-t, --token <token>", "Authentication token")
  .option(
    "-b, --browser <url>",
    "Connect to existing Chrome instance (e.g., http://localhost:9222)",
  )
  .action(async (options) => {
    try {
      const client = await getAuthenticatedClient(options);
      console.log("Refreshing all workspaces...");
      const workspaces = await client.refreshAllWorkspaces();
      console.log(`Refreshed ${workspaces.length} workspace(s)`);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();
