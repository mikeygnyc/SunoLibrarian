import * as fs from "fs";
import * as path from "path";
import { assertNotCancelled } from "./cancellation";
import { ISongData, IProcessorConfig, AudioFormat } from "./lib/interfaces";
import { AudioConverter } from "./audio-converter";
import { MetadataProcessor } from "./metadata-processor";
import { normalizeMetadata } from "./lib/metadata/normalize-metadata";
import * as logger from "./converter-logger"; // dual console/file logger
import {
  createMetadataStore,
  exportMetadataDatabaseToJson,
  MetadataStoreConfig,
  resolveMetadataStoreConfig,
} from "./metadata-store";


export class Processor {
  private converter: AudioConverter;
  private metadataProc: MetadataProcessor;
  private skipped: string[] = [];
  private processed: string[] = [];
  private songs: ISongData[] = [];
  private dirtyClipIds: Set<string> = new Set();
  private imageLog: string[] = [];

  // queue for files that were busy on deletion; we will retry them slowly in
  // the background using a timer so they don't block processing.
  private retryQueue: Set<string> = new Set();
  private retryTimer: NodeJS.Timeout | null = null;
  private runTimestamp: string | null = null;
  private inferredProcessClipIds: Set<string> | null | undefined;

  // When a 403 is encountered during image download, all image downloads pause
  // for 2 minutes. a shared promise tracks this wait so all image downloads
  // can coordinate, but other tasks (audio conversion, etc.) proceed normally.
  private imageWaitPromise: Promise<void> = Promise.resolve();

  // utility to avoid repeated try/catch blocks when checking file existence
  private async fileExists(p: string): Promise<boolean> {
    try {
      await fs.promises.access(p, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async resolveSourceWavPath(
    song: ISongData,
  ): Promise<{ wavPath: string | null; source: "input" | "output" | "none" }> {
    const inputWavPath = path.join(this.config.inputRoot, "wav", `${song.clipId}.wav`);
    if (await this.fileExists(inputWavPath)) {
      return { wavPath: inputWavPath, source: "input" };
    }

    const outputWavPath = path.join(this.config.outputRoot, "wav", `${song.clipId}.wav`);
    if (await this.fileExists(outputWavPath)) {
      return { wavPath: outputWavPath, source: "output" };
    }

    return { wavPath: null, source: "none" };
  }

  constructor(private config: IProcessorConfig) {
    this.converter = new AudioConverter(config);
    this.metadataProc = new MetadataProcessor(config);
    // retry worker can start immediately; directories will be ensured in process()
    this.startRetryWorker();
  }

  private getMetadataFilePath(): string {
    return this.config.metadataFilePath
      ? path.resolve(this.config.metadataFilePath)
      : path.join(this.config.outputRoot, "songs_metadata.json");
  }

  private getMetadataStoreConfig(): MetadataStoreConfig {
    return resolveMetadataStoreConfig({
      databaseType: this.config.metadataDatabaseType,
      database: this.config.metadataDatabasePath,
      postgresUrl: this.config.metadataPostgresUrl,
    });
  }

  private getProcessTargetClipIds(): Set<string> | null {
    const clipIds = this.config.processClipIds
      ?.map((clipId) => clipId.trim())
      .filter((clipId) => clipId.length > 0);
    if (clipIds?.length) {
      return new Set(clipIds);
    }

    if (this.inferredProcessClipIds !== undefined) {
      return this.inferredProcessClipIds;
    }

    const inferredClipIds = inferProcessTargetClipIdsFromRoots(this.config.inputRoot, this.config.outputRoot);
    this.inferredProcessClipIds = inferredClipIds.size > 0 ? inferredClipIds : null;
    return this.inferredProcessClipIds;
  }

  private getProcessSongs(songs: ISongData[]): ISongData[] {
    const targetClipIds = this.getProcessTargetClipIds();
    return targetClipIds ? songs.filter((song) => targetClipIds.has(song.clipId)) : songs;
  }

  async process(): Promise<void> {
    await assertNotCancelled(this.config);
    const startTime = Date.now();
    // make sure output directories exist before doing anything else
    await this.ensureDirectories();
    // metadata loader is now async
    this.songs = await this.loadMetadata();
    const processSongs = this.getProcessSongs(this.songs);
    // create a single run timestamp so incremental log writes use the same
    // filename for this run instead of creating a new file on every song.
    this.runTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
    if (!this.config.processClipIds?.length) {
      const inferredClipIds = this.getProcessTargetClipIds();
      if (inferredClipIds) {
        logger.log(`Inferred ${inferredClipIds.size} process target clip id${inferredClipIds.size === 1 ? "" : "s"} from input/output roots`);
      }
    }
    logger.log(`Found ${processSongs.length} songs to process`);
    if (processSongs.length !== this.songs.length) {
      logger.log(`Selected ${processSongs.length} of ${this.songs.length} metadata entries\n`);
    } else {
      logger.log("");
    }

    const songsToProcess: ISongData[] = [];
    for (const song of processSongs) {
      await assertNotCancelled(this.config);
      const { wavPath, source } = await this.resolveSourceWavPath(song);
      if (!wavPath) {
        logger.log(`  [${song.clipId}] skipping: source WAV missing in input and output`);
        this.skipped.push(`${song.clipId} - ${song.title}`);
        continue;
      }
      if (source === "output") {
        logger.log(`  [${song.clipId}] input WAV missing; using output WAV as source`);
      }

      // figure out why we would process each format; collect a log for
      // visibility so the user can understand the decision tree.
      let needsProcessing = false;
      const formatDetails: string[] = [];

      for (const format of this.config.formats.filter(f => f !== "wav")) {
        const ext = format === "alac" ? "m4a" : format;
        const outPath = path.join(this.config.outputRoot, format, `${song.clipId}.${ext}`);
        const should = this.shouldConvert(song, format);
        const exists = await this.fileExists(outPath);

        // determine the song's recorded timestamp for this format (if any)
        const tsKey = `${format}Timestamp` as keyof ISongData;
        const tsVal = song[tsKey] as any;
        const ts: Date | null | undefined = tsVal instanceof Date ? tsVal : tsVal ? new Date(tsVal) : null;

        // Check if the SOURCE WAV file is newer than our recorded timestamp for
        // this format. If so, the source has been updated and we need to
        // reprocess. Missing timestamp is considered stale and will trigger
        // reprocessing.
        let sourceNewer = false;
        let timestampMissing = false;
        if (!ts) {
          timestampMissing = true;
        } else {
          try {
            const wavSt = await fs.promises.stat(wavPath);
            const wavMtime = wavSt.mtime;
            if (wavMtime > ts) sourceNewer = true;
          } catch {
            // if stat fails on source, treat as needing reprocessing
            sourceNewer = true;
          }
        }

        formatDetails.push(`${format} => shouldConvert=${should}, exists=${exists}, ts=${ts ? ts.toISOString() : 'null'}, sourceNewer=${sourceNewer}`);

        if (should || !exists || timestampMissing || sourceNewer) {
          needsProcessing = true;
          // even if one format needs work we plan to process the song; keep
          // gathering details for logging but no need to check further
        }
      }

      if (needsProcessing) {
        logger.log(`  [${song.clipId}] will process (${formatDetails.join("; ")})`);
        songsToProcess.push(song);
      } else {
        logger.log(`  [${song.clipId}] skipping: up-to-date (${formatDetails.join("; ")})`);
        this.skipped.push(`${song.clipId} - ${song.title} - ${formatDetails.join("; ")} (up-to-date)`);
      }
    }

    const concurrency = this.config.processConcurrency || 4;
    logger.log(`Processing ${songsToProcess.length} songs with concurrency limit of ${concurrency}\n`);

    // dynamic concurrency: start up to `concurrency` songs and when any one
    // finishes immediately kick off the next.  using a Set so we can delete
    // entries as they resolve.
    const active = new Set<Promise<void>>();
    for (let songIdx = 0; songIdx < songsToProcess.length; songIdx++) {
      await assertNotCancelled(this.config);
      const song = songsToProcess[songIdx];
      const p = this.processSong(song, songIdx + 1, songsToProcess.length)
        .catch(err => {
          // bubble errors if requested; otherwise swallow so the queue can
          // continue after logging.
          if (this.config.exitOnError) throw err;
        })
        .finally(() => active.delete(p));

      active.add(p);
      if (active.size >= concurrency) {
        // wait for one to finish before queuing another
        await Promise.race(active);
        await assertNotCancelled(this.config);
      }
    }

    // wait for remaining in-flight songs
    await Promise.all(active);

    await assertNotCancelled(this.config);
    await this.updateExistingFiles(processSongs);
    // Persist final state (async)
    await assertNotCancelled(this.config);
    await this.persistState();
    await assertNotCancelled(this.config);
    await this.copyFinalMetadataToOutput();
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.log(`\nTotal time: ${elapsed}s`);
  }

  private async processSong(song: ISongData, index: number, total: number): Promise<void> {
    await assertNotCancelled(this.config);
    const remaining = total - index;
    const startTime = Date.now();
    let lastTime = startTime;
    const logStep = (name: string) => {
      const now = Date.now();
      logger.log(`  step ${name} took ${((now - lastTime)/1000).toFixed(2)}s`);
      lastTime = now;
    };

    const { wavPath, source } = await this.resolveSourceWavPath(song);
    if (!wavPath) {
      logger.log(`  [${index}/${total}] Skipping: ${song.clipId} - source WAV missing in input and output`);
      return;
    }
    if (source === "output") {
      logger.log(`  [${index}/${total}] Using output WAV as source for ${song.clipId}`);
    }
    
    logger.log(`[${index}/${total}] Processing: ${song.clipId} - ${song.title} (${remaining} remaining)`);
    
    logger.log("  starting downloadImageIfNeeded");
    await assertNotCancelled(this.config);
    await this.downloadImageIfNeeded(song, true);
    logStep("downloadImageIfNeeded");

    // Check if copyWav will do work and if any formats will be converted
    const willCopyWav = await this.wouldCopyWav(song, wavPath);
    const willConvertAnyFormat = this.config.formats
      .filter(format => format !== "wav")
      .some(format => this.shouldConvert(song, format));

    // Track actual completion
    let didCopyWav = false;
    
    if (willCopyWav) {
      logger.log("  starting copyWav");
      await assertNotCancelled(this.config);
      didCopyWav = await this.copyWav(song, wavPath);
      logStep("copyWav");
    }
    
    // Track whether we actually completed any format conversions
    // (distinguished from attempting but failing to convert)
    let completedAnyFormat = false;
    
    // Convert and embed each format.  by default we do them in parallel
    // to make better use of `processConcurrency`, but a caller could always
    // wrap processSong itself in additional queuing if they wished to limit
    // ffmpeg processes further.
    const formatTasks = this.config.formats
      .filter(format => format !== "wav")
      .map(async format => {
        await assertNotCancelled(this.config);
        if (!this.shouldConvert(song, format)) {
          logger.log(`  Skipping ${format.toUpperCase()} (timestamp not in range)`);
          return;
        }

        const ext = format === "alac" ? "m4a" : format;
        const filePath = path.join(this.config.outputRoot, format, `${song.clipId}.${ext}`);

        // Delete existing file to force fresh conversion
        if (await this.fileExists(filePath)) {
          logger.log(`  Deleting existing ${format.toUpperCase()} to reconvert`);
          await assertNotCancelled(this.config);
          const removed = await this.safeUnlink(filePath);
          if (!removed) {
            logger.warn(`  Could not remove busy file; skipping ${format.toUpperCase()}`);
            return;
          }
        }

        logger.log(`  Converting to ${format.toUpperCase()}`);
        const convStart = Date.now();
        await assertNotCancelled(this.config);
        await this.converter.convertFormat(wavPath, filePath, format);
        const convElapsed = ((Date.now() - convStart) / 1000).toFixed(1);
        logger.log(`  ${format.toUpperCase()} conversion took ${convElapsed}s`);

        const embedStartTime = Date.now();
        logger.log(`  Embedding metadata in ${format.toUpperCase()}`);
        try {
          await assertNotCancelled(this.config);
          await this.metadataProc.embedMetadata(song, ext, filePath);
          const elapsed = ((Date.now() - embedStartTime) / 1000).toFixed(1);
          logger.log(`  ${format.toUpperCase()} embedded in ${elapsed}s`);
        } catch (err) {
          logger.error(`  Failed to embed metadata: ${err}`);
          if (this.config.exitOnError) throw err;
        }

        // record when this format was last produced
        const tsKey = `${format}Timestamp` as keyof ISongData;
        (song as any)[tsKey] = new Date();
        completedAnyFormat = true;
        this.processed.push(`${song.clipId} - ${song.title} - ${format}`);
        this.logRunningSummary();

      });

    // run all conversions concurrently and wait for them to finish.  if
    // one fails and exitOnError is set we propagate the failure.
    await Promise.all(formatTasks);

    // Save sidecar files AFTER format tasks complete, but only if we actually
    // completed any work (copyWav or successful format conversion). This prevents
    // looping if a format conversion is blocked (e.g., file busy).
    if (didCopyWav || completedAnyFormat) {
      logger.log("  starting saveSidecarFiles");
      await assertNotCancelled(this.config);
      await this.metadataProc.saveSidecarFiles(song);
      logStep("saveSidecarFiles");
    }
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.log(`  [${index}/${total}] Completed in ${elapsed}s (${remaining - 1} remaining)`);


    // persist progress immediately, but don't block the song; the write
    // is queued and will complete sequentially.  final run terminates will
    // await the chain in process().
    if (didCopyWav || completedAnyFormat) {
      this.dirtyClipIds.add(song.clipId);
      this.persistState().catch(() => {});
    }
  }

  private async writeLogFiles(): Promise<void> {
    const logDir = this.config.inputRoot;

    try {
      logger.log(`\nLog files written to: ${logDir}`);

      if (this.processed.length > 0) {
        const processedLog = path.join(logDir, `processed.log`);
        await fs.promises.writeFile(processedLog, this.processed.join("\n"));
        logger.log(`✓ Processed ${this.processed.length} files: ${processedLog}`);
      }

      if (this.skipped.length > 0) {
        const skippedLog = path.join(logDir, `skipped.log`);
        await fs.promises.writeFile(skippedLog, this.skipped.join("\n"));
        logger.log(`⚠ Skipped ${this.skipped.length} files: ${skippedLog}`);
      }

      if (this.imageLog.length > 0) {
        const imageLogFile = path.join(logDir, `images.log`);
        await fs.promises.writeFile(imageLogFile, this.imageLog.join("\n"));
        logger.log(`📷 Image operations: ${imageLogFile}`);
      }
    } catch (err: any) {
      logger.warn(`Failed to write log files: ${err.message || err}`);
    }
  }

  private logRunningSummary(): void {
    logger.log(
      `↻ Running summary: processed=${this.processed.length}, skipped=${this.skipped.length}, imageOps=${this.imageLog.length}`,
    );
  }

  private shouldConvert(song: ISongData, format: AudioFormat): boolean {
    // Determine whether we should (re)generate a given format for a song.
    // We have a couple of modes:
    //   * reconvertMissing: only when the timestamp is completely absent
    //   * date filters: before/after boundaries on an existing timestamp
    //   * default: always convert

    const tsKey = `${format}Timestamp` as keyof ISongData;
    const tsVal = song[tsKey] as any;
    const ts: Date | null | undefined = tsVal instanceof Date ? tsVal : tsVal ? new Date(tsVal) : null;

    // missing-only mode overrides everything.  if we don't yet have a
    // timestamp we should convert, otherwise we skip even if boundaries are
    // provided.
    if (this.config.reconvertMissing) {
      return !ts;
    }

    // if timestamp doesn't exist we always convert
    if (!ts) return true;

    const before = this.config.reconvertBefore;
    const after = this.config.reconvertAfter;

    // if no date filters are specified then we only convert when the
    // timestamp is missing; this is the behaviour users expect when
    // re‑running the tool without any reconvert flags.  previously we
    // blindly returned `true`, which forced a full re‑encode every time.
    if (!before && !after) return !ts;

    // if either boundary matches, convert
    if (before && ts <= before) return true;
    if (after && ts >= after) return true;

    // otherwise skip
    return false;
  }

  private async wouldCopyWav(song: ISongData, wavPath: string): Promise<boolean> {
    if (!this.config.formats.includes("wav")) return false;
    const outputWavPath = path.join(this.config.outputRoot, "wav", `${song.clipId}.wav`);
    
    if (!(await this.fileExists(outputWavPath))) {
      return true;
    } else if (!(await this.filesMatch(wavPath, outputWavPath))) {
      return true;
    }

    return false;
  }

  /**
   * Returns a list of tracks whose artwork either doesn't exist or is invalid.
   * This is intended to power a lightweight ``download-images --fetch-image-list`` mode so the CLI can
   * download images separately without needing to run the full processing
   * pipeline.
   */
  public async getImagesNeedingDownload(): Promise<{ clipId: string; thumbnail: string | null }[]> {
    const songs = await this.loadMetadata();
    const results: { clipId: string; thumbnail: string | null }[] = [];

    for (const song of songs) {
      await assertNotCancelled(this.config);
      if (!song.thumbnail) continue;
      const ext = path.extname(song.thumbnail) || ".jpeg";
      const inputPath = path.join(this.config.inputRoot, "images", `${song.clipId}${ext}`);
      const outputPath = path.join(this.config.outputRoot, "images", `${song.clipId}${ext}`);

      // Consider either location as satisfying the image requirement, but keep
      // corruption checks so invalid files still get re-downloaded.
      const inputExists = await this.fileExists(inputPath);
      const outputExists = await this.fileExists(outputPath);
      const hasValidInput = inputExists ? await this.isValidImage(inputPath) : false;
      const hasValidOutput = outputExists ? await this.isValidImage(outputPath) : false;
      const needsDownload = !hasValidInput && !hasValidOutput;

      if (needsDownload) {
        results.push({ clipId: song.clipId, thumbnail: song.thumbnail });
      }
    }

    return results;
  }

  private async copyWav(song: ISongData, wavPath: string): Promise<boolean> {
    await assertNotCancelled(this.config);
    if (!this.config.formats.includes("wav")) return false;
    const outputWavPath = path.join(this.config.outputRoot, "wav", `${song.clipId}.wav`);
    
    let didCopy = false;
    if (!(await this.fileExists(outputWavPath))) {
      logger.log(`  Copying WAV`);
      await fs.promises.copyFile(wavPath, outputWavPath);
      didCopy = true;
    } else if (!(await this.filesMatch(wavPath, outputWavPath))) {
      logger.log(`  Updating WAV (content changed)`);
      await fs.promises.copyFile(wavPath, outputWavPath);
      didCopy = true;
    }

    if (didCopy) {
      song.wavTimestamp = new Date();
    }
    
    return didCopy;
  }

  private async filesMatch(file1: string, file2: string): Promise<boolean> {
    const stat1 = await fs.promises.stat(file1);
    const stat2 = await fs.promises.stat(file2);
    return stat1.size === stat2.size;
    // more expensive comparisons could be added here if needed
  }

  private async embedAllFormats(song: ISongData): Promise<void> {
    const tasks = this.config.formats
      .filter(format => format !== "wav")
      .map(async format => {
        const ext = format === "alac" ? "m4a" : format;
        const filePath = path.join(this.config.outputRoot, format, `${song.clipId}.${ext}`);
        
        if (await this.fileExists(filePath)) {
          const startTime = Date.now();
          logger.log(`  Embedding metadata in ${format.toUpperCase()}`);
          try {
            await this.metadataProc.embedMetadata(song, ext, filePath);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            logger.log(`  ${format.toUpperCase()} embedded in ${elapsed}s`);
          } catch (err) {
            logger.error(`  Failed to embed metadata: ${err}`);
            if (this.config.exitOnError) throw err;
          }
        }
      });
    
    await Promise.all(tasks);
  }

  private async updateExistingFiles(songs: ISongData[]): Promise<void> {
    await assertNotCancelled(this.config);
    logger.log("\n=== Updating all files with metadata ===");
    const processedIds = new Set(this.processed.map(p => p.split(" - ")[0]));
    const songsToUpdate = songs.filter(song => !processedIds.has(song.clipId));
    
    const concurrency = this.config.updateConcurrency || 8;
    logger.log(`Updating ${songsToUpdate.length} songs with concurrency limit of ${concurrency}\n`);

    const active = new Set<Promise<void>>();
    for (let songIdx = 0; songIdx < songsToUpdate.length; songIdx++) {
      await assertNotCancelled(this.config);
      const song = songsToUpdate[songIdx];
      const p = this.updateSong(song, songIdx + 1, songsToUpdate.length)
        .catch(err => {
          if (this.config.exitOnError) throw err;
        })
        .finally(() => active.delete(p));
      active.add(p);
      if (active.size >= concurrency) {
        await Promise.race(active);
        await assertNotCancelled(this.config);
      }
    }
    await Promise.all(active);
  }

  private async updateSong(song: ISongData, index: number, total: number): Promise<void> {
    await assertNotCancelled(this.config);
    const remaining = total - index;
    const startTime = Date.now();
    const { wavPath, source } = await this.resolveSourceWavPath(song);
    let hasAudioUpdates = false;

    if (!wavPath) return;

    logger.log(`[${index}/${total}] Updating: ${song.clipId} - ${song.title} (${remaining} remaining)`);
    if (source === "output") {
      logger.log(`  input WAV missing; using output WAV as source`);
    }

    const tasks = this.config.formats
      .filter((format) => format !== "wav")
      .map(async (format) => {
        await assertNotCancelled(this.config);
        const statusKey = `${format}Status` as keyof ISongData;
        if (!song[statusKey]) return;

        const filePath = path.join(
          this.config.outputRoot,
          format,
          `${song.clipId}.${format === "alac" ? "m4a" : format}`,
        );

        if (!this.shouldConvert(song, format)) {
          if (await this.fileExists(filePath)) {
            logger.log(`  Skipping ${format.toUpperCase()} (timestamp not in range)`);
            return;
          }
        }

        hasAudioUpdates = true;
        await assertNotCancelled(this.config);
        await this.downloadImageIfNeeded(song, true);

        const ext = format === "alac" ? "m4a" : format;
        if (!(await this.fileExists(filePath))) {
          logger.log(`Recreating: ${song.clipId} (${format})`);
        } else {
          logger.log(`Recreating: ${song.clipId} (${format}) - metadata update`);
          const removed = await this.safeUnlink(filePath);
          if (!removed) {
            logger.warn(`  Could not remove busy file ${filePath}`);
            return;
          }
        }

        {
          const convStart = Date.now();
          await assertNotCancelled(this.config);
          await this.converter.convertFormat(wavPath, filePath, format);
          const convElapsed = ((Date.now() - convStart) / 1000).toFixed(1);
          logger.log(`  ${format.toUpperCase()} conversion took ${convElapsed}s`);
        }

        await assertNotCancelled(this.config);
        await this.metadataProc.embedMetadata(song, ext, filePath);

        const tsKey = `${format}Timestamp` as keyof ISongData;
        (song as any)[tsKey] = new Date();
        this.processed.push(`${song.clipId} - ${song.title} - ${format} (update)`);
        this.logRunningSummary();
      });

    await Promise.all(tasks);

    if (hasAudioUpdates) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.log(`  [${index}/${total}] Updated in ${elapsed}s (${remaining - 1} remaining)`);
      this.dirtyClipIds.add(song.clipId);
    }

    // Only persist when this update pass actually modified outputs/metadata.
    // Persisting unchanged songs creates a long write queue and repeats the
    // same summary log block many times.
    if (hasAudioUpdates) {
      this.persistState().catch(() => {});
    }
  }
  private metadataDatabaseExisted = false;

  private async loadMetadata(): Promise<ISongData[]> {
    const storeConfig = this.getMetadataStoreConfig();
    const store = await createMetadataStore(storeConfig);
    this.metadataDatabaseExisted = await store.exists();
    const targetClipIds = this.getProcessTargetClipIds();
    let songs: ISongData[];
    try {
      if (targetClipIds) {
        logger.log(`Loading ${targetClipIds.size} targeted metadata entr${targetClipIds.size === 1 ? "y" : "ies"} from database`);
        songs = await store.loadByClipIds(Array.from(targetClipIds));
      } else {
        songs = await store.loadAll();
      }
    } catch (err: any) {
      logger.error(`Failed to read metadata database: ${err.message || err}`);
      await store.close();
      throw err;
    }
    await store.close();

    if (!this.metadataDatabaseExisted) {
      logger.warn(`Metadata database not found; created empty database: ${store.location}`);
      return [];
    }

    const normalizedSongs: ISongData[] = songs.map(song => normalizeMetadata(song));

    this.songs = normalizedSongs;

    return normalizedSongs;
  }

  private async saveMetadata(): Promise<void> {
    await assertNotCancelled(this.config);
    if (this.dirtyClipIds.size === 0) {
      logger.log("Skipping metadata database write: no changed songs");
      return;
    }

    const dirtyClipIds = new Set(this.dirtyClipIds);
    const dirtySongs = this.songs
      .filter((song) => dirtyClipIds.has(song.clipId))
      .map((song) => normalizeMetadata(song));
    if (dirtySongs.length === 0) {
      logger.warn("Skipping metadata database write: changed songs were not loaded");
      dirtyClipIds.forEach((clipId) => this.dirtyClipIds.delete(clipId));
      return;
    }

    const store = await createMetadataStore(this.getMetadataStoreConfig());
    try {
      logger.log(`Writing ${dirtySongs.length} changed metadata entr${dirtySongs.length === 1 ? "y" : "ies"} to database`);
      for (const song of dirtySongs) {
        await assertNotCancelled(this.config);
        await store.upsert(song);
      }
      dirtyClipIds.forEach((clipId) => this.dirtyClipIds.delete(clipId));
    } catch (err: any) {
      logger.warn(`Failed to update metadata database: ${err.message || err}`);
    } finally {
      await store.close();
    }
  }

  private async copyFinalMetadataToOutput(): Promise<void> {
    await assertNotCancelled(this.config);
    if (this.config.copySongsMetadataToOutput !== true) return;

    const outFile = this.getMetadataFilePath();
    try {
      await exportMetadataDatabaseToJson(outFile, this.getMetadataStoreConfig());
      logger.log(`Exported finalized songs_metadata.json to output: ${outFile}`);
    } catch (err: any) {
      logger.warn(`Failed to export songs_metadata.json: ${err.message || err}`);
    }
  }

  private async cleanupOldBackups(baseFilePath: string): Promise<void> {
    // Find all backup files matching the pattern baseFilePath.*.bak
    const dir = path.dirname(baseFilePath);
    const filename = path.basename(baseFilePath);
    const backupPattern = new RegExp(`^${filename}\.\\d+\.bak$`);

    try {
      const files = await fs.promises.readdir(dir);
      const backups = files
        .filter(f => backupPattern.test(f))
        .map(f => ({
          name: f,
          path: path.join(dir, f),
          timestamp: parseInt(f.match(/\\d+/)?.[0] || "0", 10),
        }))
        .sort((a, b) => b.timestamp - a.timestamp); // newest first

      // delete all but the 3 most recent
      if (backups.length > 3) {
        for (const backup of backups.slice(3)) {
          try {
            await fs.promises.unlink(backup.path);
            logger.log(`  deleted old backup: ${backup.name}`);
          } catch (err: any) {
            logger.warn(`  failed to delete backup ${backup.name}: ${err.message}`);
          }
        }
      }
    } catch (err: any) {
      logger.warn(`failed to clean up backups: ${err.message}`);
    }
  }

  private async safeUnlink(filePath: string): Promise<boolean> {
    // attempt to remove a file, retrying a few times when EBUSY is encountered
    const attempts = 3;
    for (let i = 0; i < attempts; i++) {
      try {
        await fs.promises.unlink(filePath);
        return true;
      } catch (err: any) {
        if (err.code === 'EBUSY') {
          const wait = 500 * (i + 1);
          logger.log(`  safeUnlink: file busy, waiting ${wait}ms (attempt ${i + 1})`);
          await new Promise(resolve => setTimeout(resolve, wait));
          continue;
        }
        // other errors should not trigger retry queue
        return false;
      }
    }
    // still busy after immediate attempts - schedule background retry
    this.scheduleRetry(filePath);
    return false;
  }
  /**
   * Save metadata database and log files immediately.  This is called after each
   * song is processed so that a crash part-way through a run leaves behind a
   * useful state and log.
   */
  

  private scheduleRetry(filePath: string) {
    if (!this.retryQueue.has(filePath)) {
      logger.log(`  scheduling delayed retry for busy file: ${filePath}`);
      this.retryQueue.add(filePath);
    }
  }

  private startRetryWorker() {
    // slow interval (30s) to avoid hammering the filesystem
    this.retryTimer = setInterval(() => {
      // fire-and-forget; failures logged internally
      this.processRetryQueue().catch(err => logger.warn(`retry worker error: ${err}`));
    }, 30 * 1000);
    // allow node to exit if this is the only thing remaining
    this.retryTimer.unref();
  }

  private async processRetryQueue() {
    if (this.retryQueue.size === 0) return;
    for (const filePath of Array.from(this.retryQueue)) {
      try {
        await fs.promises.unlink(filePath);
        logger.log(`  background removed busy file: ${filePath}`);
        this.retryQueue.delete(filePath);
      } catch (err: any) {
        if (err.code !== 'EBUSY') {
          logger.warn(`  background failed to remove ${filePath}: ${err.message}`);
          this.retryQueue.delete(filePath);
        }
        // if still busy we leave it in the queue for the next interval
      }
    }
  }

  // chain used to serialize all persistence operations; we always
  // append to this promise so that writes never overlap.
  private persistenceChain: Promise<void> = Promise.resolve();

  private persistState(): Promise<void> {
    // enqueue the work and return the chain so callers may optionally await it
    this.persistenceChain = this.persistenceChain.then(async () => {
      await this.saveMetadata();
      await this.writeLogFiles();
    }).catch(err => {
      // ensure the chain continues even if one write fails
      logger.warn(`persistState error: ${err}`);
    });
    return this.persistenceChain;
  }

  private dateReviver(key: string, value: any): any {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(value)) {
      return new Date(value);
    }
    return value;
  }

  private async ensureDirectories(): Promise<void> {
    await assertNotCancelled(this.config);
    const inputImages = path.join(this.config.inputRoot, "images");
    if (!(await this.fileExists(inputImages))) {
      await fs.promises.mkdir(inputImages, { recursive: true });
    }
    
    const dirs = ["metadata", "lyrics", "images", ...this.config.formats];
    for (const dir of dirs) {
      const fullPath = path.join(this.config.outputRoot, dir);
      if (!(await this.fileExists(fullPath))) {
        await fs.promises.mkdir(fullPath, { recursive: true });
      }
    }
  }
  private async downloadImageIfNeeded(song: ISongData, hasAudioUpdates: boolean): Promise<void> {
    await assertNotCancelled(this.config);
    if (!song.thumbnail) {
      this.imageLog.push(`${song.clipId}: No thumbnail URL`);
      return;
    }
    
    const ext = path.extname(song.thumbnail) || ".jpeg";
    const inputPath = path.join(this.config.inputRoot, "images", `${song.clipId}${ext}`);
    const outputPath = path.join(this.config.outputRoot, "images", `${song.clipId}${ext}`);

    let hasValidInput = false;
    if (await this.fileExists(inputPath)) {
      hasValidInput = await this.isValidImage(inputPath);
      if (!hasValidInput) {
        logger.log(`  Input image corrupted, will try output image before download`);
        this.imageLog.push(`${song.clipId}: Input image corrupted`);
      }
    }

    // If processing-side input image is missing/invalid, reuse a valid output
    // image first to avoid unnecessary network downloads.
    if (!hasValidInput && (await this.fileExists(outputPath))) {
      const hasValidOutput = await this.isValidImage(outputPath);
      if (hasValidOutput) {
        await fs.promises.copyFile(outputPath, inputPath);
        hasValidInput = true;
        logger.log(`  Reused output image: ${outputPath} -> ${inputPath}`);
        this.imageLog.push(`${song.clipId}: Reused output image`);
      }
    }

    let needsDownload = !hasValidInput || !song.thumbnail.includes("image_large");

    if (!needsDownload) {
      this.imageLog.push(`${song.clipId}: Image OK, skipping download`);
      return;
    }
    
    if (!hasAudioUpdates && (await this.fileExists(inputPath))) {
      this.imageLog.push(`${song.clipId}: No audio updates, skipping re-download`);
      return;
    }
    
    await this.downloadImage(song, inputPath);
  }
  private async isValidImage(imgPath: string): Promise<boolean> {
    try {
      logger.log(`  Validating image: ${imgPath}`);
      const buffer = await fs.promises.readFile(imgPath);
      if (buffer.length < 100) {
        logger.log(`  Invalid image (${imgPath}): file too small (${buffer.length} bytes)`);
        return false;
      }
      if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
        logger.log(`  Invalid image (${imgPath}): missing JPEG SOI marker`);
        return false;
      }
      
      let offset = 2;
      while (offset < buffer.length) {
        if (buffer[offset] !== 0xFF) break;
        const marker = buffer[offset + 1];
        if (marker === 0xC0 || marker === 0xC2) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          const isLargeEnough = width >= 1024 && height >= 1024;
          if (!isLargeEnough) {
            logger.log(`  Invalid image (${imgPath}): dimensions too small (${width}x${height})`);
            return false;
          }
          logger.log(`  Image valid (${imgPath}): ${width}x${height}`);
          return true;
        }
        offset += 2 + buffer.readUInt16BE(offset + 2);
      }
      logger.log(`  Invalid image (${imgPath}): no supported JPEG dimension marker found`);
      return false;
    } catch (err: any) {
      logger.log(`  Invalid image (${imgPath}): read/parse error - ${err?.message || err}`);
      return false;
    }
  }

  private async downloadImage(song: ISongData, inputPath: string): Promise<void> {
    const tempPath = `${inputPath}.tmp`;

    logger.log(`  Downloading image: ${song.thumbnail}`);
    this.imageLog.push(`${song.clipId}: Downloading from ${song.thumbnail}`);

    // Wait for any global image 403 pause to finish. this is non-blocking
    // for other tasks, but all image downloads coordinate via this promise.
    await this.imageWaitPromise;

    // download with 403 retry logic
    let attempt = 0;
    let lastStatusCode = 0;
    while (attempt < 2) {
      attempt++;
      try {
        const result = await this.performImageDownload(song, tempPath);
        if (result.success) {
          // move temp file to final location
          const size = (await fs.promises.stat(tempPath)).size;
          await fs.promises.rename(tempPath, inputPath);
          this.imageLog.push(`${song.clipId}: Downloaded successfully (${size} bytes) to ${inputPath}`);
          logger.log(`  Image downloaded: ${size} bytes`);
          return;
        }

        lastStatusCode = result.statusCode || 0;
        if (lastStatusCode === 403) {
          if (attempt < 2) {
            // Set up a global 2-minute wait that *all* image downloads will respect,
            // but don't block other non-image tasks.  The first image download to
            // hit a 403 triggers this pause; subsequent image requests will await it.
            this.setImageWait(120000); // 2 minute pause
            logger.log(`  Got HTTP 403, pausing all image downloads for 2 minutes...`);
            this.imageLog.push(`${song.clipId}: HTTP 403 - all image downloads pausing for 2 min`);
            // await the wait promise before retry
            await this.imageWaitPromise;
            continue;
          }
        }

        // non-403 error or final attempt failed
        if (await this.fileExists(tempPath)) await fs.promises.unlink(tempPath);
        const errMsg = `Failed to download image: HTTP ${lastStatusCode}`;
        logger.error(`  ${errMsg}`);
        this.imageLog.push(`${song.clipId}: ${errMsg}`);
        throw new Error(errMsg);
      } catch (err: any) {
        if (await this.fileExists(tempPath)) await fs.promises.unlink(tempPath);
        if (attempt >= 2) {
          const errMsg = `Failed to download image: ${err.message}`;
          logger.error(`  ${errMsg}`);
          this.imageLog.push(`${song.clipId}: ${errMsg}`);
          throw err;
        }
        // on first attempt, check if it was a 403; if so, set global pause
        if (lastStatusCode === 403) {
          this.setImageWait(120000); // 2 minute pause
          logger.log(`  Got HTTP 403, pausing all image downloads for 2 minutes...`);
          this.imageLog.push(`${song.clipId}: HTTP 403 - all image downloads pausing for 2 min`);
          // await the pause before retry
          await this.imageWaitPromise;
          continue;
        }
        // otherwise propagate the error
        throw err;
      }
    }
  }

  // Establish a global pause for all image downloads. If one is already
  // pending, this extends it; otherwise a new wait is initiated.
  private setImageWait(ms: number): void {
    const waitPromise = new Promise<void>(resolve => {
      setTimeout(() => {
        logger.log(`  Image download pause lifted after ${ms / 1000}s`);
        resolve();
      }, ms);
    });
    // Chain the new wait to the existing promise so all image downloads see a
    // coordinated pause, even if they arrive while one is already pending.
    this.imageWaitPromise = this.imageWaitPromise.then(() => waitPromise);
  }

  private async performImageDownload(
    song: ISongData,
    tempPath: string,
  ): Promise<{ success: boolean; statusCode?: number }> {
    return new Promise((resolve) => {
      const https = require("https");
      const file = fs.createWriteStream(tempPath);
      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Referer': 'https://suno.com/',
          'Sec-Fetch-Dest': 'image',
          'Sec-Fetch-Mode': 'no-cors',
          'Sec-Fetch-Site': 'cross-site'
        }
      };

      const req = https.get(song.thumbnail, options, (response: any) => {
        const statusCode = response.statusCode;
        this.imageLog.push(`${song.clipId}: HTTP ${statusCode}`);
        logger.log(`  Image response: HTTP ${statusCode}`);

        if (statusCode !== 200) {
          file.close();
          fs.promises.unlink(tempPath).catch(() => {});
          resolve({ success: false, statusCode });
          return;
        }

        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve({ success: true });
        });
        file.on("error", (err: any) => {
          fs.promises.unlink(tempPath).catch(() => {});
          this.imageLog.push(`${song.clipId}: File write error - ${err.message}`);
          resolve({ success: false });
        });
      });

      req.on("error", (err: any) => {
        fs.promises.unlink(tempPath).catch(() => {});
        this.imageLog.push(`${song.clipId}: Download error - ${err.message}`);
        resolve({ success: false });
      });
    });
  }

  async ensureImage(song: ISongData): Promise<void> {
    if (!song.thumbnail) return;
    
    const ext = path.extname(song.thumbnail) || ".jpeg";
    const inputPath = path.join(this.config.inputRoot, "images", `${song.clipId}${ext}`);
    const outputPath = path.join(this.config.outputRoot, "images", `${song.clipId}${ext}`);
    
    if (!(await this.fileExists(inputPath))) {
      await this.downloadImage(song, inputPath);
    }
    
    if (await this.fileExists(inputPath) && !(await this.fileExists(outputPath))) {
      await fs.promises.copyFile(inputPath, outputPath);
    }
  }
}

export function inferProcessTargetClipIdsFromRoots(inputRoot: string, outputRoot: string): Set<string> {
  const clipIds = new Set<string>();
  const candidateDirs = [
    path.join(inputRoot, "metadata"),
    path.join(inputRoot, "wav"),
    path.join(inputRoot, "mp3"),
    path.join(outputRoot, "wav"),
    path.join(outputRoot, "flac"),
    path.join(outputRoot, "mp3"),
    path.join(outputRoot, "alac"),
  ];

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      continue;
    }

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue;
      }

      const clipId = path.parse(entry.name).name.trim();
      if (clipId.length > 0) {
        clipIds.add(clipId);
      }
    }
  }

  return clipIds;
}
