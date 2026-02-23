import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { ISongData, ProcessorConfig, AudioFormat } from "./types";

const execFileAsync = promisify(execFile);

export class AudioConverter {
  constructor(private config: ProcessorConfig) {}

  async convert(metadata: ISongData, wavPath: string): Promise<void> {
    for (const format of this.config.formats) {
      if (format === "wav") continue;
      
      const outPath = this.getOutputPath(metadata.clipId, format);
      if (fs.existsSync(outPath)) {
        console.log(`  ${format.toUpperCase()} exists, skipping conversion`);
        continue;
      }

      console.log(`  Converting to ${format.toUpperCase()}`);
      await this.convertFormat(wavPath, outPath, format);
    }
  }

  async convertFormat(wavPath: string, outPath: string, format: AudioFormat): Promise<void> {
    const args = ["-y", "-i", wavPath];
    
    if (format === "flac") {
      args.push("-c:a", "flac", outPath);
    } else if (format === "alac") {
      args.push("-c:a", "alac", outPath);
    } else if (format === "mp3") {
      args.push("-c:a", "libmp3lame", "-b:a", `${this.config.mp3Bitrate}k`, outPath);
    }

    console.log(`    ffmpeg command: ${JSON.stringify(args)}`);
    await execFileAsync("ffmpeg", args);
  }

  private getOutputPath(clipId: string, format: AudioFormat): string {
    const ext = format === "alac" ? "m4a" : format;
    return path.join(this.config.outputRoot, format, `${clipId}.${ext}`);
  }
}
