import * as fs from "fs";
import * as path from "path";
import { ISongData, ProcessorConfig, AudioFormat } from "./types";
import { AudioConverter } from "./converter";
import { MetadataProcessor } from "./metadata";

export class Processor {
  private converter: AudioConverter;
  private metadataProc: MetadataProcessor;
  private skipped: string[] = [];
  private processed: string[] = [];
  private songs: ISongData[] = [];
  private imageLog: string[] = [];

  constructor(private config: ProcessorConfig) {
    this.converter = new AudioConverter(config);
    this.metadataProc = new MetadataProcessor(config);
    this.ensureDirectories();
  }

  async process(): Promise<void> {
    const startTime = Date.now();
    this.songs = this.loadMetadata();
    console.log(`Found ${this.songs.length} songs to process\n`);

    const songsToProcess = this.songs.filter(song => {
      const wavPath = path.join(this.config.inputRoot, "wav", `${song.clipId}.wav`);
      if (!fs.existsSync(wavPath)) {
        this.skipped.push(`${song.clipId} - ${song.title}`);
        return false;
      }
      return true;
    });

    console.log(`Processing ${songsToProcess.length} songs with concurrency limit of 4\n`);
    
    const concurrency = 4;
    for (let i = 0; i < songsToProcess.length; i += concurrency) {
      const batch = songsToProcess.slice(i, i + concurrency);
      await Promise.all(batch.map(song => this.processSong(song)));
    }

    await this.updateExistingFiles(this.songs);
    this.saveMetadata();
    this.writeLogFiles();
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nTotal time: ${elapsed}s`);
  }

  private async processSong(song: ISongData): Promise<void> {
    const startTime = Date.now();
    const wavPath = path.join(this.config.inputRoot, "wav", `${song.clipId}.wav`);
    
    console.log(`Processing: ${song.clipId} - ${song.title}`);
    this.processed.push(`${song.clipId} - ${song.title}`);
    
    await this.downloadImageIfNeeded(song, true);
    await this.copyWav(song, wavPath);
    await this.metadataProc.saveSidecarFiles(song);
    await this.converter.convert(song, wavPath);
    await this.embedAllFormats(song);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  Completed in ${elapsed}s`);
  }

  private writeLogFiles(): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logDir = this.config.outputRoot;
    
    console.log(`\nLog files written to: ${logDir}`);
    
    if (this.processed.length > 0) {
      const processedLog = path.join(logDir, `processed_${timestamp}.log`);
      fs.writeFileSync(processedLog, this.processed.join("\n"));
      console.log(`✓ Processed ${this.processed.length} files: ${processedLog}`);
    }
    
    if (this.skipped.length > 0) {
      const skippedLog = path.join(logDir, `skipped_${timestamp}.log`);
      fs.writeFileSync(skippedLog, this.skipped.join("\n"));
      console.log(`⚠ Skipped ${this.skipped.length} files: ${skippedLog}`);
    }
    
    if (this.imageLog.length > 0) {
      const imageLogFile = path.join(logDir, `images_${timestamp}.log`);
      fs.writeFileSync(imageLogFile, this.imageLog.join("\n"));
      console.log(`📷 Image operations: ${imageLogFile}`);
    }
  }

  private async copyWav(song: ISongData, wavPath: string): Promise<void> {
    if (!this.config.formats.includes("wav")) return;
    const outputWavPath = path.join(this.config.outputRoot, "wav", `${song.clipId}.wav`);
    
    if (!fs.existsSync(outputWavPath)) {
      console.log(`  Copying WAV`);
      fs.copyFileSync(wavPath, outputWavPath);
    } else if (!this.filesMatch(wavPath, outputWavPath)) {
      console.log(`  Updating WAV (content changed)`);
      fs.copyFileSync(wavPath, outputWavPath);
    }
  }

  private filesMatch(file1: string, file2: string): boolean {
    const stat1 = fs.statSync(file1);
    const stat2 = fs.statSync(file2);
    return (stat1.size === stat2.size);
    
    // // For large files, just compare size and mtime
    // if (stat1.size > 10 * 1024 * 1024) {
    //   return stat1.mtimeMs === stat2.mtimeMs;
    // }
    
    // const buf1 = fs.readFileSync(file1);
    // const buf2 = fs.readFileSync(file2);
    // return buf1.equals(buf2);
  }

  private async embedAllFormats(song: ISongData): Promise<void> {
    const tasks = this.config.formats
      .filter(format => format !== "wav")
      .map(async format => {
        const ext = format === "alac" ? "m4a" : format;
        const filePath = path.join(this.config.outputRoot, format, `${song.clipId}.${ext}`);
        
        if (fs.existsSync(filePath)) {
          const startTime = Date.now();
          console.log(`  Embedding metadata in ${format.toUpperCase()}`);
          try {
            await this.metadataProc.embedMetadata(song, ext, filePath);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`  ${format.toUpperCase()} embedded in ${elapsed}s`);
          } catch (err) {
            console.error(`  Failed to embed metadata: ${err}`);
            if (this.config.exitOnError) throw err;
          }
        }
      });
    
    await Promise.all(tasks);
  }

  private async updateExistingFiles(songs: ISongData[]): Promise<void> {
    console.log("\n=== Updating all files with metadata ===");
    const processedIds = new Set(this.processed.map(p => p.split(" - ")[0]));
    const songsToUpdate = songs.filter(song => !processedIds.has(song.clipId));
    
    console.log(`Updating ${songsToUpdate.length} songs with concurrency limit of 8\n`);

    const concurrency = 8;
    for (let i = 0; i < songsToUpdate.length; i += concurrency) {
      const batch = songsToUpdate.slice(i, i + concurrency);
      await Promise.all(batch.map(song => this.updateSong(song)));
    }
  }

  private async updateSong(song: ISongData): Promise<void> {
    const startTime = Date.now();
    const wavPath = path.join(this.config.inputRoot, "wav", `${song.clipId}.wav`);
    const hasWav = fs.existsSync(wavPath);
    let hasAudioUpdates = false;

    if (!hasWav) return;

    for (const format of this.config.formats) {
      if (format === "wav") continue;
      
      const statusKey = `${format}Status` as keyof ISongData;
      if (!song[statusKey]) continue;

      const ext = format === "alac" ? "m4a" : format;
      const filePath = path.join(this.config.outputRoot, format, `${song.clipId}.${ext}`);
      
      if (!fs.existsSync(filePath)) {
        console.log(`Recreating: ${song.clipId} (${format})`);
        hasAudioUpdates = true;
        await this.downloadImageIfNeeded(song, true);
        await this.converter.convertFormat(wavPath, filePath, format);
        await this.metadataProc.embedMetadata(song, ext, filePath);
      } else {
        console.log(`Recreating: ${song.clipId} (${format}) - metadata update`);
        hasAudioUpdates = true;
        fs.unlinkSync(filePath);
        await this.converter.convertFormat(wavPath, filePath, format);
        await this.metadataProc.embedMetadata(song, ext, filePath);
      }
    }
    
    if (hasAudioUpdates) {
      await this.downloadImageIfNeeded(song, true);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  Updated in ${elapsed}s`);
    }
  }

  private loadMetadata(): ISongData[] {
    const metaFile = path.join(this.config.inputRoot, "songs_metadata.json");
    if (!fs.existsSync(metaFile)) {
      console.error(`Metadata file not found: ${metaFile}`);
      return [];
    }

    const data = JSON.parse(fs.readFileSync(metaFile, "utf-8"), this.dateReviver);
    const songs = Array.isArray(data) ? data : [];
    
    // Import normalizeMetadata to recalculate all derived fields
    const { normalizeMetadata } = require("./utils");
    return songs.map(song => normalizeMetadata(song));
  }

  private saveMetadata(): void {
    const metaFile = path.join(this.config.outputRoot, "songs_metadata.json");
    fs.writeFileSync(metaFile, JSON.stringify(this.songs, null, 2));
  }

  private dateReviver(key: string, value: any): any {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(value)) {
      return new Date(value);
    }
    return value;
  }

  private ensureDirectories(): void {
    const inputImages = path.join(this.config.inputRoot, "images");
    if (!fs.existsSync(inputImages)) fs.mkdirSync(inputImages, { recursive: true });
    
    const dirs = ["metadata", "lyrics", "images", ...this.config.formats];
    for (const dir of dirs) {
      const fullPath = path.join(this.config.outputRoot, dir);
      if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  private async downloadImageIfNeeded(song: ISongData, hasAudioUpdates: boolean): Promise<void> {
    if (!song.thumbnail) {
      this.imageLog.push(`${song.clipId}: No thumbnail URL`);
      return;
    }
    
    const ext = path.extname(song.thumbnail) || ".jpeg";
    const inputPath = path.join(this.config.inputRoot, "images", `${song.clipId}${ext}`);
    
    let needsDownload = !fs.existsSync(inputPath) || !song.thumbnail.includes("image_large");
    
    if (fs.existsSync(inputPath) && !needsDownload) {
      if (!this.isValidImage(inputPath)) {
        console.log(`  Image corrupted, re-downloading`);
        this.imageLog.push(`${song.clipId}: Image corrupted, re-downloading`);
        fs.unlinkSync(inputPath);
        needsDownload = true;
      }
    }
    
    if (!needsDownload) {
      this.imageLog.push(`${song.clipId}: Image OK, skipping download`);
      return;
    }
    
    if (!hasAudioUpdates && fs.existsSync(inputPath)) {
      this.imageLog.push(`${song.clipId}: No audio updates, skipping re-download`);
      return;
    }
    
    await this.downloadImage(song, inputPath);
  }

  private isValidImage(imgPath: string): boolean {
    try {
      const buffer = fs.readFileSync(imgPath);
      if (buffer.length < 100) return false;
      if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) return false;
      
      let offset = 2;
      while (offset < buffer.length) {
        if (buffer[offset] !== 0xFF) break;
        const marker = buffer[offset + 1];
        if (marker === 0xC0 || marker === 0xC2) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          return width >= 1024 && height >= 1024;
        }
        offset += 2 + buffer.readUInt16BE(offset + 2);
      }
      return false;
    } catch {
      return false;
    }
  }

  private async downloadImage(song: ISongData, inputPath: string): Promise<void> {
    const tempPath = `${inputPath}.tmp`;
    
    console.log(`  Downloading image: ${song.thumbnail}`);
    this.imageLog.push(`${song.clipId}: Downloading from ${song.thumbnail}`);
    
    try {
      const https = require("https");
      const file = fs.createWriteStream(tempPath);
      await new Promise((resolve, reject) => {
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
        
        https.get(song.thumbnail, options, (response: any) => {
          const statusCode = response.statusCode;
          this.imageLog.push(`${song.clipId}: HTTP ${statusCode}`);
          console.log(`  Image response: HTTP ${statusCode}`);
          
          if (statusCode !== 200) {
            file.close();
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            reject(new Error(`HTTP ${statusCode}`));
            return;
          }
          
          response.pipe(file);
          file.on("finish", () => {
            file.close();
            const size = fs.statSync(tempPath).size;
            fs.renameSync(tempPath, inputPath);
            this.imageLog.push(`${song.clipId}: Downloaded successfully (${size} bytes) to ${inputPath}`);
            console.log(`  Image downloaded: ${size} bytes`);
            resolve(null);
          });
          file.on("error", (err: any) => {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            this.imageLog.push(`${song.clipId}: File write error - ${err.message}`);
            reject(err);
          });
        }).on("error", (err: any) => {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          this.imageLog.push(`${song.clipId}: Download error - ${err.message}`);
          reject(err);
        });
      });
    } catch (err: any) {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      const errMsg = `Failed to download image: ${err.message}`;
      console.error(`  ${errMsg}`);
      this.imageLog.push(`${song.clipId}: ${errMsg}`);
    }
  }

  async ensureImage(song: ISongData): Promise<void> {
    if (!song.thumbnail) return;
    
    const ext = path.extname(song.thumbnail) || ".jpeg";
    const inputPath = path.join(this.config.inputRoot, "images", `${song.clipId}${ext}`);
    const outputPath = path.join(this.config.outputRoot, "images", `${song.clipId}${ext}`);
    
    if (!fs.existsSync(inputPath)) {
      await this.downloadImage(song, inputPath);
    }
    
    if (fs.existsSync(inputPath) && !fs.existsSync(outputPath)) {
      fs.copyFileSync(inputPath, outputPath);
    }
  }
}
