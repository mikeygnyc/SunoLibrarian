import * as fs from "fs";
import { AppConfig } from "./ConfigHandler";
import { ISongData } from "./ISongData";
import { promisify } from "util";
import { execFile } from "child_process";
import { IDownloadHandlingConfig } from "./IDownloadHandlingConfig";
import path from "path";
import { MetadataProcessor } from "./MetadataHandler";
const asyncCopyFile = promisify(fs.copyFile);
const asyncDeleteFile = promisify(fs.rm);
const execFileAsync = promisify(execFile);
export type TDirectoryType =
  | "alac"
  | "flac"
  | "wav"
  | "mp3"
  | "metadata"
  | "images"
  | "lyrics";
export class FileHandler {
  async convertWav(metadata: ISongData) {
    const wavFilePath = `${AppConfig.wavDirectoryPath}/${metadata.clipId}.wav`;
    if (!fs.existsSync(wavFilePath)) {
      throw new Error(`WAV file not found for clipId ${metadata.clipId}`);
    }
    for (const format of AppConfig.audioFormats) {
      if (format === "wav") {
        console.log(
          `        ->  WAV format selected, no conversion needed for ${metadata.clipId}`
        );
      }
      if (format === "flac") {
        const flacPath = `${AppConfig.flacDirectoryPath}/${metadata.clipId}.flac`;
        console.log(`        ->  Converting ${metadata.clipId} to flac`);
        try {
          await execFileAsync(
            "ffmpeg",
            this.createFfmpegExecArgs(flacPath, wavFilePath, "flac")
          );
          metadata.flacStatus = "CREATED";
        } catch (error) {
          console.log(
            `        ->  Error converting ${
              metadata.clipId
            } to flac: ${JSON.stringify(error)}`
          );
          metadata.flacStatus = "FAILED";
        }
      }
      if (format === "alac") {
        try {
          const alacPath = `${AppConfig.alacDirectoryPath}/${metadata.clipId}.m4a`;
          console.log(`        ->  Converting ${metadata.clipId} to alac`);
          await execFileAsync(
            "ffmpeg",
            this.createFfmpegExecArgs(alacPath, wavFilePath, "alac")
          );
          metadata.alacStatus = "CREATED";
        } catch (error) {
          console.log(
            `        ->  Error converting ${
              metadata.clipId
            } to alac: ${JSON.stringify(error)}`
          );
          metadata.alacStatus = "FAILED";
        }
      }
      if (format === "mp3") {
        if (AppConfig.useSunoMp3FileIfAvailable) {
          console.log(
            `        ->  MP3 format selected, no conversion needed for ${metadata.clipId}`
          );
        } else {
          try {
            const mp3Path = `${AppConfig.mp3DirectoryPath}/${metadata.clipId}.mp3`;
            console.log(`        ->  Converting ${metadata.clipId} to mp3`);
            let imagePath = path.join(
              //@ts-ignore
              AppConfig.imagesDirectoryPath,
              //@ts-ignore
              `${metadata.clipId}${path.extname(metadata.thumbnail)}`
            );

            if (!fs.existsSync(imagePath)) {
              imagePath = "";
            }

            await execFileAsync(
              "ffmpeg",
              this.createFfmpegExecArgs(mp3Path, wavFilePath, "mp3", imagePath)
            );
            metadata.mp3Status = "CREATED";
          } catch (error) {
            console.log(
              `        ->  Error converting ${
                metadata.clipId
              } to mp3: ${JSON.stringify(error)}`
            );
            metadata.mp3Status = "FAILED";
          }
        }
      }
    }
    await MetadataProcessor.embedMetadataInFile(metadata);
    return;
  }

  copyToOtherLocations(metadata: ISongData) {
    if (!AppConfig.copyDownloadsToOtherLocation) {
      return;
    }
    const clipId = metadata.clipId;
    const audioDirs: TDirectoryType[] = ["alac", "flac", "mp3", "wav"];
    const metadataDirs: TDirectoryType[] = ["metadata", "images", "lyrics"];
    let sourceMap: Map<TDirectoryType, string> = new Map<
      TDirectoryType,
      string
    >(); //maps a single source to each dirtype
    let targetMap: Map<TDirectoryType, string[]> = new Map<
      TDirectoryType,
      string[]
    >(); //maps all dests to each dirtype

    audioDirs.concat(metadataDirs).forEach((metaDir: TDirectoryType) => {
      const source = this.makeOtherSourcePath(
        metaDir,
        clipId,
        this.extensionLookupByDirType(metaDir)
      );
      sourceMap.set(metaDir, source);
    });
    AppConfig.otherLocationConfig.forEach(
      async (copyConfig: IDownloadHandlingConfig) => {
        metadataDirs
          .concat(copyConfig.formats)
          .forEach((metaDir: TDirectoryType) => {
            const dest = this.makeOtherDestPath(
              metaDir,
              copyConfig.directoryPath,
              clipId,
              this.extensionLookupByDirType(metaDir)
            );
            let targets = targetMap.get(metaDir) || [];
            targets.push(dest);
            targetMap.set(metaDir, targets);
          });
      }
    );
    sourceMap.forEach((sourcePath: string, dirType: TDirectoryType) => {
      let targets = targetMap.get(dirType);
      if (targets) {
        targets.forEach((destPath: string) => {
          asyncCopyFile(sourcePath, destPath)
            .catch((reason: any) => {
              console.log(
                `          --> Error copying ${dirType} ${sourcePath} to ${destPath}! error: ${JSON.stringify(
                  reason
                )}`
              );
            })
            .then(() => {
              console.log(
                `          --> Copied ${dirType} ${sourcePath} to ${destPath}`
              );
              if (!AppConfig.retainOriginalsAfterCopying) {
                console.log(
                  `          --> Removing original ${dirType} ${sourcePath}`
                );
                asyncDeleteFile(sourcePath)
                  .catch((reason: any) => {
                    console.log(
                      `          --> Error deleting ${dirType} ${sourcePath} after copy! error: ${JSON.stringify(
                        reason
                      )}`
                    );
                  })
                  .then(() => {
                    console.log(
                      `          --> Removed ${dirType} ${sourcePath}`
                    );
                  });
              }
            });
        });
      }
    });
    if (!AppConfig.audioFormats.includes("wav")) {
      let wavPath = sourceMap.get("wav") || "";
      asyncDeleteFile(wavPath);
    }
  }
  private extensionLookupByDirType(dirType: TDirectoryType): string {
    let extension: string = ".txt";
    switch (dirType) {
      case "metadata":
        extension = "json";
        break;
      case "images":
        extension = "jpeg";
        break;
      case "lyrics":
        extension = "txt";
        break;
      case "alac":
        extension = "m4a";
        break;
      case "flac":
        extension = "flac";
        break;
      case "mp3":
        extension = "mp3";
        break;
      case "wav":
        extension = "wav";
        break;
    }
    return extension;
  }

  private makeOtherDestPath(
    directoryType: TDirectoryType,
    destPathRoot: string,
    clipId: string,
    extension: string
  ) {
    return path.join(destPathRoot, directoryType, `${clipId}.${extension}`);
  }

  private makeOtherSourcePath(
    directoryType: TDirectoryType,
    clipId: string,
    extension: string
  ) {
    return path.join(
      (AppConfig as any)[`${directoryType}DirectoryPath`],
      `${clipId}.${extension}`
    );
  }

  createFfmpegExecArgs(
    outputPath: string,
    wavPath: string,
    format: "alac" | "flac" | "mp3",
    imagePath?: string
  ): string[] {
    let wavPart: string[] = ["-y", "-i", wavPath];
    let conversionPart: string[] = [];
    switch (format) {
      case "alac":
        conversionPart = ["-c:a", "alac"];
        break;
      case "flac":
        conversionPart = ["-c:a", "flac"];
        break;
      case "mp3":
        let mainArgs: string[] = [];
        if (AppConfig.embedImagesInConvertedFiles && imagePath) {
          mainArgs = [
            "-i",
            imagePath,
            "-map",
            "0:a",
            "-map",
            "1:v",
            "-c:1",
            "copy",
            "-id3v2_version",
            "4",
            "-metadata:s:v",
            'title="Album cover"',
            "-metadata:s:v",
            'comment="Cover (front)"',
          ];
        } else {
          mainArgs = ["-map", "0:a"];
        }
        wavPart = wavPart.concat(mainArgs);
        conversionPart = [
          "-c:a",
          "libmp3lame",
          "-b:a",
          `${AppConfig.convertedMp3BitrateKbps}k`,
        ];
        break;
      default:
        break;
    }

    const outputPart: string[] = [outputPath];

    const retVal: string[] = wavPart.concat(conversionPart).concat(outputPart);
    console.log(
      `      ->  running ffmpeg with command: ffmpeg ${retVal.join(" ")}`
    );
    return retVal;
  }
}

export const Converter: FileHandler = new FileHandler();
