import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { ISongData, ProcessorConfig } from "./types";
import { splitTags } from "./utils";

const execFileAsync = promisify(execFile);

export class MetadataProcessor {
  constructor(private config: ProcessorConfig) {}

  private async fileExists(p: string): Promise<boolean> {
    try { await fs.promises.access(p, fs.constants.F_OK); return true; }
    catch { return false; }
  }

  async embedMetadata(metadata: ISongData, format: string, filePath: string): Promise<void> {
    if (format === "flac") await this.embedFlac(metadata, filePath);
    else if (format === "m4a") await this.embedAlac(metadata, filePath);
    else if (format === "mp3") await this.embedMp3(metadata, filePath);
  }

  async saveSidecarFiles(metadata: ISongData): Promise<void> {
    await Promise.all([
      this.saveMetadataJson(metadata),
      this.saveLyrics(metadata),
      this.copyImage(metadata)
    ]);
  }

  private async saveMetadataJson(meta: ISongData): Promise<void> {
    const metadataPath = path.join(this.config.outputRoot, "metadata", `${meta.clipId}.json`);
    const cleanMeta = { ...meta };
    delete (cleanMeta as any).mp3Status;
    delete (cleanMeta as any).flacStatus;
    delete (cleanMeta as any).alacStatus;
    delete (cleanMeta as any).wavStatus;
    await fs.promises.writeFile(metadataPath, JSON.stringify(cleanMeta, null, 2));
  }

  private async saveLyrics(meta: ISongData): Promise<void> {
    if (!meta.lyrics) return;
    const lyricsPath = path.join(this.config.outputRoot, "lyrics", `${meta.clipId}.txt`);
    await fs.promises.writeFile(lyricsPath, meta.lyrics);
  }

  private async copyImage(meta: ISongData): Promise<void> {
    if (!meta.thumbnail) return;
    const ext = path.extname(meta.thumbnail) || ".jpeg";
    const inputPath = path.join(this.config.inputRoot, "images", `${meta.clipId}${ext}`);
    const outputPath = path.join(this.config.outputRoot, "images", `${meta.clipId}${ext}`);

    // processSong already downloaded the image when necessary, so we avoid
    // re-downloading here.  Just copy if the source exists and target is
    // missing.
    if (await this.fileExists(inputPath) && !(await this.fileExists(outputPath))) {
      const start = Date.now();
      await fs.promises.copyFile(inputPath, outputPath);
      const dur = ((Date.now() - start) / 1000).toFixed(2);
      console.log(`  copyImage took ${dur}s`);
    }
  }

  private async embedFlac(meta: ISongData, flacPath: string): Promise<void> {
    const startTime = Date.now();
    const tagsList = splitTags(meta.rawApiResponse?.display_tags) || meta.tags || [];
    const displayTags = tagsList.join(", ");
    const isSourceMaterial = meta.upload || false;
    const modelStr = meta.rawApiResponse?.model_name ? `Suno ${meta.rawApiResponse.major_model_version} (${meta.rawApiResponse.model_name})` : `Suno ${meta.model || "unknown"}`;
    const lines = [
      `TITLE=${this.clean(meta.title)}`,
      `ARTIST=${this.clean(meta.artistName)}`,
      `ALBUM=${this.clean(meta.projectName || meta.artistName)}`,
      `AI_MODEL=${this.clean(modelStr)}`,
      `MODEL_NAME=${this.clean(meta.rawApiResponse?.model_name)}`,
      `DATE=${this.dateStr(meta.creationDate)}`,
      `CONTACT=${this.clean(meta.songUrl)}`,
      `SUNO_ID=${this.clean(meta.clipId)}`,
      `DESCRIPTION=${this.clean(meta.style || "-N/A-")}`,
      `FAVORITE=${meta.liked || false}`,
    ];
    if (meta.weirdness != null) lines.push(`SUNO_WEIRDNESS=${meta.weirdness}%`);
    if (meta.styleStrength != null) lines.push(`SUNO_STYLE_STRENGTH=${meta.styleStrength}%`);
    if (meta.audioStrength != null) lines.push(`SUNO_AUDIO_STRENGTH=${meta.audioStrength}%`);
    if (displayTags) lines.push(`SUNO_TAGS=${this.clean(displayTags)}`);
    if (meta.negativeTags?.length) lines.push(`SUNO_NEGATIVE_TAGS=${this.clean(meta.negativeTags.join(", "))}`);
    if (meta.remixParent) lines.push(`SUNO_REMIX_PARENT=${this.clean(meta.remixParent)}`);
    if (meta.duration) lines.push(`LENGTH=${this.clean(meta.duration)}`);
    if (meta.rawApiResponse?.metadata?.task) lines.push(`SUNO_TASK=${this.clean(meta.rawApiResponse.metadata.task)}`);
    if (meta.personaName) lines.push(`SUNO_PERSONA=${this.clean(meta.personaName)}`);
    if (meta.personaId) lines.push(`SUNO_PERSONA_ID=${this.clean(meta.personaId)}`);
    if (meta.projectName) lines.push(`SUNO_PROJECT=${this.clean(meta.projectName)}`);
    if (meta.explicit != null) lines.push(`EXPLICIT=${meta.explicit}`);
    if (meta.isHidden != null) lines.push(`SUNO_IS_HIDDEN=${meta.isHidden}`);
    if (meta.mashupSource?.length) lines.push(`SUNO_MASHUP_CLIPS=${this.clean(meta.mashupSource.join(","))}`);
    if (meta.gptDescriptionPrompt) lines.push(`SUNO_GPT_PROMPT=${this.clean(meta.gptDescriptionPrompt)}`);
    if (meta.flaggedReason) lines.push(`SUNO_FLAGGED_REASON=${this.clean(meta.flaggedReason)}`);
    if (isSourceMaterial) lines.push(`SUNO_IS_SOURCE_MATERIAL=true`);
    if (meta.rawApiResponse) lines.push(`SUNO_RAW_DATA=${this.clean(JSON.stringify(meta.rawApiResponse))}`);

    const tmpFile = path.join(this.config.outputRoot, "metadata", `${meta.clipId}_vorbis.txt`);
    await fs.promises.writeFile(tmpFile, lines.join(os.EOL));
    
    const args = [`--import-tags-from=${tmpFile}`];
    
    if (this.config.embedLyrics && meta.lyrics) {
      const lyricsPath = path.join(this.config.outputRoot, "lyrics", `${meta.clipId}.txt`);
      if (await this.fileExists(lyricsPath)) args.push(`--set-tag-from-file=LYRICS=${lyricsPath}`);
    }
    
    if (this.config.embedImages && meta.thumbnail) {
      const imgPath = await this.getImagePath(meta);
      if (imgPath && await this.fileExists(imgPath) && await this.isValidImage(imgPath)) args.push(`--import-picture-from=3||||${imgPath}`);
    }
    
    args.push(flacPath);
    console.log(`    metaflac command: ${JSON.stringify(args)}`);
    await execFileAsync("metaflac", args);
    try { await fs.promises.rm(tmpFile); } catch {}
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`    metaflac: ${elapsed}s`);
  }

  private async embedAlac(meta: ISongData, alacPath: string): Promise<void> {
    const startTime = Date.now();
    const tagsList = splitTags(meta.rawApiResponse?.display_tags) || meta.tags || [];
    const isSourceMaterial = meta.upload || false;
    const modelStr = meta.rawApiResponse?.model_name ? `Suno ${meta.rawApiResponse.major_model_version} (${meta.rawApiResponse.model_name})` : `Suno ${meta.model || "unknown"}`;
    let args = [
      alacPath,
      "-W",
      "--artist", meta.artistName || "Unknown Artist",
      "--title", meta.title || "Untitled",
      "--album", meta.projectName || meta.artistName || "",
      "--year", this.yearStr(meta.creationDate),
      "--description", meta.style || "[No Prompt]",
      ...this.createCustomAtom("AMDL", "text", modelStr, "AIModel"),
      ...this.createCustomAtom("SURL", "text", meta.songUrl || "", "SongURL"),
      ...this.createCustomAtom("SCID", "text", meta.clipId || "", "SunoSongID"),
      ...this.createCustomAtom("SLIK", "text", String(meta.liked || false), "SunoLiked"),
    ];
    if (meta.weirdness != null) args.push(...this.createCustomAtom("SWED", "text", `${meta.weirdness}%`, "SunoWeirdness"));
    if (meta.styleStrength != null) args.push(...this.createCustomAtom("SSST", "text", `${meta.styleStrength}%`, "SunoStyleStrength"));
    if (meta.audioStrength != null) args.push(...this.createCustomAtom("SAST", "text", `${meta.audioStrength}%`, "SunoAudioStrength"));
    if (meta.explicit != null) args.push("--advisory", meta.explicit ? "explicit" : "clean");
    if (tagsList.length) args.push(...this.createCustomAtom("STAG", "text", tagsList.join(","), "SunoTags"));
    if (meta.negativeTags?.length) args.push(...this.createCustomAtom("SNTG", "text", meta.negativeTags.join(", "), "SunoNegativeTags"));
    if (meta.remixParent) args.push(...this.createCustomAtom("SRMX", "text", meta.remixParent, "SunoRemixParent"));
    if (meta.rawApiResponse?.metadata?.task) args.push(...this.createCustomAtom("STSK", "text", meta.rawApiResponse.metadata.task, "SunoTask"));
    if (meta.personaName) args.push(...this.createCustomAtom("SPER", "text", meta.personaName, "SunoPersona"));
    if (meta.personaId) args.push(...this.createCustomAtom("SPID", "text", meta.personaId, "SunoPersonaID"));
    if (meta.projectName) args.push(...this.createCustomAtom("SPRJ", "text", meta.projectName, "SunoProject"));
    if (meta.isHidden != null) args.push(...this.createCustomAtom("SHID", "text", String(meta.isHidden), "SunoIsHidden"));
    if (meta.mashupSource?.length) args.push(...this.createCustomAtom("SMSH", "text", meta.mashupSource.join(","), "SunoMashupClips"));
    if (meta.gptDescriptionPrompt) args.push(...this.createCustomAtom("SGPT", "text", meta.gptDescriptionPrompt, "SunoGPTPrompt"));
    if (meta.flaggedReason) args.push(...this.createCustomAtom("SFLG", "text", meta.flaggedReason, "SunoFlaggedReason"));
    if (meta.duration) args.push(...this.createCustomAtom("SDUR", "text", meta.duration, "SunoDuration"));
    if (isSourceMaterial) args.push(...this.createCustomAtom("SSRC", "text", "true", "SunoIsSourceMaterial"));
    if (this.config.embedLyrics && meta.lyrics) {
      const lyricsPath = path.join(this.config.outputRoot, "lyrics", `${meta.clipId}.txt`);
      if (await this.fileExists(lyricsPath)) args.push("--lyricsFile", lyricsPath);
    }
    if (this.config.embedImages && meta.thumbnail) {
      const imgPath = await this.getImagePath(meta);
      if (imgPath && await this.fileExists(imgPath) && await this.isValidImage(imgPath)) args.push("--artwork", imgPath);
    }
    console.log(`    atomicparsley command: ${JSON.stringify(args)}`);
    try {
      await execFileAsync("atomicparsley", args);
    } catch (err: any) {
      console.error(`    atomicparsley stderr: ${err.stderr}`);
      console.error(`    atomicparsley stdout: ${err.stdout}`);
      throw err;
    }
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`    atomicparsley: ${elapsed}s`);
  }

  private createCustomAtom(atomName: string, argType: string, value: string, fullName: string): string[] {
    return ["--rDNSatom", value, `name=${fullName}`, `domain=com.apple.iTunes`];
  }

  private async embedMp3(meta: ISongData, mp3Path: string): Promise<void> {
    const startTime = Date.now();
    const tagsList = splitTags(meta.rawApiResponse?.display_tags) || meta.tags || [];
    const isSourceMaterial = meta.upload || false;
    const modelStr = meta.rawApiResponse?.model_name ? `Suno ${meta.rawApiResponse.major_model_version} (${meta.rawApiResponse.model_name})` : `Suno ${meta.model || "unknown"}`;
    
    const tempPath = `${mp3Path}.tmp.mp3`;
    const args = ["-loglevel", "error", "-i", mp3Path, "-y"];
    
    if (this.config.embedImages && meta.thumbnail) {
      const imgPath = await this.getImagePath(meta);
      if (imgPath && await this.fileExists(imgPath) && await this.isValidImage(imgPath)) {
        args.push("-i", imgPath, "-map", "0:a", "-map", "1:v");
      } else {
        args.push("-map", "0:a");
      }
    } else {
      args.push("-map", "0:a");
    }
    
    args.push("-c", "copy");
    args.push("-metadata", `title=${meta.title || "Untitled"}`);
    args.push("-metadata", `artist=${meta.artistName || "Unknown Artist"}`);
    args.push("-metadata", `album=${meta.projectName || meta.artistName || ""}`);
    args.push("-metadata", `date=${this.yearStr(meta.creationDate)}`);
    args.push("-metadata", `WOAF=${meta.songUrl || ""}`);
    
    // Add custom TXXX frames for extended metadata
    args.push("-metadata", `ai_model=${modelStr}`);
    args.push("-metadata", `suno_song_id=${meta.clipId}`);
    args.push("-metadata", `liked=${meta.liked ? "true" : "false"}`);
    if (tagsList.length) args.push("-metadata", `tags=${tagsList.join(",")}`);
    if (meta.weirdness != null) args.push("-metadata", `weirdness=${meta.weirdness}%`);
    if (meta.styleStrength != null) args.push("-metadata", `style_strength=${meta.styleStrength}%`);
    if (meta.audioStrength != null) args.push("-metadata", `audio_strength=${meta.audioStrength}%`);
    if (meta.explicit != null) args.push("-metadata", `explicit=${meta.explicit ? "true" : "false"}`);
    if (meta.negativeTags?.length) args.push("-metadata", `negative_tags=${meta.negativeTags.join(", ")}`);
    if (meta.remixParent) args.push("-metadata", `remix_parent_id=${meta.remixParent}`);
    if (meta.rawApiResponse?.metadata?.task) args.push("-metadata", `task=${meta.rawApiResponse.metadata.task}`);
    if (meta.personaName) args.push("-metadata", `persona=${meta.personaName}`);
    if (meta.personaId) args.push("-metadata", `persona_id=${meta.personaId}`);
    if (meta.projectName) args.push("-metadata", `project=${meta.projectName}`);
    if (meta.isHidden != null) args.push("-metadata", `is_hidden=${String(meta.isHidden)}`);
    if (meta.mashupSource?.length) args.push("-metadata", `mashup_clips=${meta.mashupSource.join(",")}`);
    if (meta.gptDescriptionPrompt) args.push("-metadata", `gpt_prompt=${meta.gptDescriptionPrompt}`);
    if (meta.flaggedReason) args.push("-metadata", `flagged_reason=${meta.flaggedReason}`);
    if (meta.duration) args.push("-metadata", `duration=${meta.duration}`);
    if (isSourceMaterial) args.push("-metadata", `is_source_material=true`);
    
    if (this.config.embedImages && meta.thumbnail) {
      const imgPath = await this.getImagePath(meta);
      if (imgPath && await this.fileExists(imgPath) && await this.isValidImage(imgPath)) {
        args.push("-disposition:v:0", "attached_pic");
      }
    }
    
    args.push(tempPath);
    
    console.log(`    ffmpeg command: ${JSON.stringify(args)}`);
    await execFileAsync("ffmpeg", args);
    try { await fs.promises.rename(tempPath, mp3Path); } catch (err) { throw err; }
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`    ffmpeg: ${elapsed}s`);
  }

  private async isValidImage(imgPath: string): Promise<boolean> {
    try {
      const buffer = await fs.promises.readFile(imgPath);
      if (buffer.length < 100) return false;
      if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) return false;
      
      let offset = 2;
      while (offset < buffer.length) {
        if (buffer[offset] !== 0xFF) break;
        const marker = buffer[offset + 1];
        if (marker === 0xC0 || marker === 0xC2) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          return width >= 100 && height >= 100;
        }
        offset += 2 + buffer.readUInt16BE(offset + 2);
      }
      return false;
    } catch {
      return false;
    }
  }

  private async getImagePath(meta: ISongData): Promise<string | null> {
    if (!meta.thumbnail) return null;
    const imgPath = path.join(this.config.outputRoot, "images", `${meta.clipId}${path.extname(meta.thumbnail)}`);
    
    if (!(await this.fileExists(imgPath))) {
      const inputPath = path.join(this.config.inputRoot, "images", `${meta.clipId}${path.extname(meta.thumbnail)}`);
      if (!(await this.fileExists(inputPath))) {
        const { Processor } = require("./processor");
        const processor = new Processor(this.config);
        await processor.ensureImage(meta);
      }
      if (await this.fileExists(inputPath)) {
        await fs.promises.copyFile(inputPath, imgPath);
      }
    }
    
    if (await this.fileExists(imgPath)) {
      const dimensions = await this.getImageDimensions(imgPath);
      if (dimensions && (dimensions.width < 1024 || dimensions.height < 1024)) {
        console.log(`  Image too small (${dimensions.width}x${dimensions.height}), re-downloading`);
        const { Processor } = require("./processor");
        const processor = new Processor(this.config);
        const inputPath = path.join(this.config.inputRoot, "images", `${meta.clipId}${path.extname(meta.thumbnail)}`);
        if (await this.fileExists(inputPath)) await fs.promises.unlink(inputPath);
        if (await this.fileExists(imgPath)) await fs.promises.unlink(imgPath);
        await processor.ensureImage(meta);
        if (await this.fileExists(inputPath)) {
          await fs.promises.copyFile(inputPath, imgPath);
        }
      }
    }
    
    return (await this.fileExists(imgPath)) ? imgPath : null;
  }

  private async getImageDimensions(imgPath: string): Promise<{ width: number; height: number } | null> {
    try {
      const buffer = await fs.promises.readFile(imgPath);
      if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
        let offset = 2;
        while (offset < buffer.length) {
          if (buffer[offset] !== 0xFF) break;
          const marker = buffer[offset + 1];
          if (marker === 0xC0 || marker === 0xC2) {
            return {
              height: buffer.readUInt16BE(offset + 5),
              width: buffer.readUInt16BE(offset + 7)
            };
          }
          offset += 2 + buffer.readUInt16BE(offset + 2);
        }
      }
    } catch (err) {
      console.error(`  Failed to read image dimensions: ${err}`);
    }
    return null;
  }

  private clean(val: string | null | undefined): string {
    return (val || "").replace(/\n/g, "").replace(new RegExp(os.EOL, "g"), "");
  }

  private dateStr(date: Date | null | undefined): string {
    try {
      return date ? new Date(date).toISOString() : "";
    } catch {
      return new Date().toISOString();
    }
  }

  private yearStr(date: Date | null | undefined): string {
    try {
      return date ? new Date(date).getFullYear().toString() : "";
    } catch {
      return new Date().getFullYear().toString();
    }
  }
}
