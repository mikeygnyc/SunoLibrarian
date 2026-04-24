import * as fs from "fs";
import * as path from "path";
import { ISongData, IProcessorConfig, AudioFormat } from "./lib/interfaces";
import * as logger from "./converter-logger";
import { runCommand } from "./process-utils";

export class AudioConverter {
  constructor(private config: IProcessorConfig) {}

  async convert(metadata: ISongData, wavPath: string): Promise<void> {
    const tasks = [];
    for (const format of this.config.formats) {
      if (format === "wav") continue;
      
      const outPath = this.getOutputPath(metadata.clipId, format);
      if (fs.existsSync(outPath)) {
        logger.log(`  ${format.toUpperCase()} exists, skipping conversion`);
        continue;
      }

      logger.log(`  Converting to ${format.toUpperCase()}`);
      const convStart = Date.now();
      tasks.push(
        this.convertFormat(wavPath, outPath, format).then(() => {
          const convElapsed = ((Date.now() - convStart) / 1000).toFixed(2);
          logger.log(`  ${format.toUpperCase()} conversion took ${convElapsed}s`);
        }),
      );
    }
    
    await Promise.all(tasks);
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

    logger.log(`    ffmpeg command: ${JSON.stringify(args)}`);

    const convStart = Date.now();
    await runCommand("ffmpeg", args, {
      signal: this.config.abortSignal,
    });
    const convElapsed = ((Date.now() - convStart) / 1000).toFixed(2);
    logger.log(`    conversion finished in ${convElapsed}s`);
  }

  private getOutputPath(clipId: string, format: AudioFormat): string {
    const ext = format === "alac" ? "m4a" : format;
    return path.join(this.config.outputRoot, format, `${clipId}.${ext}`);
  }
}
