#!/usr/bin/env node
import { Command } from "commander";
import { SunoClient } from "./client";
import { extractTokenFromBrowser } from "./auth";
import { SunoTrackResponse } from "./types";
import { Storage } from "./storage";
import { normalizeMetadata, ISongData } from "./utils";
import * as fs from "fs";
import * as path from "path";

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
  return new SunoClient(token);
}

function filterWorkspaces(workspaces: any[], workspaceId?: string) {
  return workspaceId
    ? workspaces.filter((w) => w.id === workspaceId)
    : workspaces;
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
      const client = await getAuthenticatedClient(options);

      if (options.flushCache) {
        console.log("Flushing cache...");
        const storage = new Storage();
        storage.clearCache();
      }
      const outputDir = path.resolve(options.output);
      const delay = parseInt(options.delay);

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
        } catch (error) {
          console.warn(
            "Failed to parse existing metadata file, starting fresh",
          );
        }
      }

      console.log("Fetching workspaces...");
      const workspaces = await client.getWorkspaces();
      console.log(`Found ${workspaces.length} workspace(s)`);

      const targetWorkspaces = filterWorkspaces(workspaces, options.workspace);

      if (targetWorkspaces.length === 0) {
        console.error("No matching workspaces found");
        process.exit(1);
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
            console.log(
              `Skipping incomplete track: ${track.title || track.id}`,
            );
            totalSkipped++;
            continue;
          }

          if (songsMetadata.find((m) => m.clipId === track.id)) {
            const existingEntry = songsMetadata.find(
              (m) => m.clipId === track.id,
            );
            if (existingEntry && !existingEntry.rawApiResponse) {
              console.log(`Updating metadata for: ${track.title || track.id}`);
              const metadata = await client.fetchTrackMetadata(track.id);
              existingEntry.rawApiResponse =
                metadata.fullData as SunoTrackResponse;
              fs.writeFileSync(
                metadataFile,
                JSON.stringify(songsMetadata, null, 2),
              );
              fs.writeFileSync(
                path.join(metadataDir, `${track.id}.json`),
                JSON.stringify(existingEntry, null, 2),
              );
              await new Promise((resolve) => setTimeout(resolve, delay)); // Small delay to avoid hitting API too quickly for metadata requests
            } else {
              console.log(`Already downloaded: ${track.title || track.id}`);
            }
            totalSkipped++;
            continue;
          }

          const audioDir = options.format === "wav" ? wavDir : mp3Dir;
          const filename = `${track.id}.${options.format}`;
          const filepath = path.join(audioDir, filename);

          console.log(
            `Downloading (${i + 1}/${tracks.length}): ${track.title || track.id}`,
          );

          try {
            const metadata = await client.fetchTrackMetadata(track.id);

            if (options.format === "wav") {
              await client.downloadWav(track.id, filepath, false);
            } else {
              await client.downloadMp3(
                track.audio_url,
                filepath,
                track.id,
                false,
              );
            }

            if (metadata.coverArt) {
              const imageExt = path.extname(metadata.coverArt) || ".jpeg";
              const imagePath = path.join(imagesDir, `${track.id}${imageExt}`);
              try {
                await client.downloadImage(metadata.coverArt, imagePath);
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
            };

            const normalizedEntry = normalizeMetadata(songEntry);

            songsMetadata.push(normalizedEntry);
            fs.writeFileSync(
              metadataFile,
              JSON.stringify(songsMetadata, null, 2),
            );
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

      console.log(
        `\nDownload complete! Downloaded: ${totalDownloaded}, Skipped: ${totalSkipped}`,
      );
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
