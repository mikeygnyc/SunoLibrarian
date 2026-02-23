import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { ISongData } from "./ISongData";
import { AppConfig } from "./ConfigHandler";
import { Importer } from "./scraper";
import { execFile } from "child_process";
import { promisify } from "util";
const execFileAsync = promisify(execFile);

class MetadataHandler {
  saveMainMetadataFile() {
    try {
      const metadataPath = path.join(
        AppConfig.downloadRootDirectoryPath,
        AppConfig.combinedSongsMetadataJsonFile
      );
      const songsArray = Array.from(this.allSongs.values());
      fs.writeFileSync(metadataPath, JSON.stringify(songsArray, null, 2));
    } catch (err) {
      console.log(`caught error saving metadata file ${err}`);
    }
  }
  loadMainMetadataFile() {
    const metadataPath = path.join(
      AppConfig.downloadRootDirectoryPath,
      AppConfig.combinedSongsMetadataJsonFile
    );

    if (fs.existsSync(metadataPath)) {
      console.log("Found existing metadata file. Loading...");
      try {
        const existingSongs: ISongData[] = JSON.parse(
          fs.readFileSync(metadataPath, "utf-8"),
          this.dateReviver
        );
        existingSongs.forEach((song) => {
          this.allSongs.set(song.clipId, song);
        });
      } catch (error) {}
      console.log(`Loaded ${this.allSongs.size} songs from file.`);
    }
  }
  public dateReviver(key: string, value: any): any {
    // Check if the value is a string and matches an ISO date format
    if (
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(value)
    ) {
      return new Date(value);
    }
    return value;
  }
  allSongs = new Map<string, ISongData>();

  async saveSongMetadata(meta: ISongData, imageOriginated?: boolean) {
    if (!AppConfig.saveMetadataSidecarFiles) {
      return;
    }
    const metadataPath = path.join(
      AppConfig.downloadRootDirectoryPath,
      "metadata",
      `${meta.clipId}.json`
    );
    let cloneMeta = Object.assign({}, meta);
    delete cloneMeta.mp3Status;
    delete cloneMeta.flacStatus;
    delete cloneMeta.alacStatus;
    delete cloneMeta.wavStatus;
    fs.writeFileSync(metadataPath, JSON.stringify(cloneMeta, null, 2));
    this.saveLyrics(meta);
    if (!imageOriginated) {
      await this.saveImage(meta);
    }
  }
  saveLyrics(metadata: ISongData) {
    if (!AppConfig.saveLyricsInTextFiles && !AppConfig.embedLyricsInMetadata) {
      return;
    }
    const lyricsPath = path.join(
      AppConfig.downloadRootDirectoryPath,
      "lyrics",
      `${metadata.clipId}.txt`
    );
    fs.writeFileSync(lyricsPath, `${metadata.lyrics}`);
  }
  fileIsEmpty(path: string): boolean {
    if (!fs.existsSync(path)) {
      return true;
    } else {
      const stats = fs.statSync(path);
      if (stats.size === 0) {
        fs.rmSync(path);
      }
      return stats.size === 0;
    }
  }
  async saveImage(metadata: ISongData) {
    if (AppConfig.saveImages || AppConfig.embedImagesInConvertedFiles) {
      const imageUrl: string = metadata.thumbnail ?? "";
      // const imgUrlArr: string[] = imageUrl.split("/");
      if (imageUrl) {
        let imageFile = `${metadata.clipId}${path.extname(imageUrl)}`;
        console.log(`      ->  Downloading image from ${imageUrl}`);
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok && !!imageFile === undefined) {
          console.log(
            `      ->  Failed to fetch image: ${imageResponse.statusText} (${imageUrl})`
          );
        } else {
          const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
          //@ts-ignore
          let imagePath = path.join(
            //@ts-ignore
            AppConfig.imagesDirectoryPath,
            //@ts-ignore
            imageFile
          );
          if (imagePath) {
            console.log(`      ->  Downloaded image to ${imagePath}`);
            fs.writeFileSync(imagePath, imageBuffer);
            metadata.imageStatus = "DOWNLOADED";
          }
          if (this.fileIsEmpty(imagePath)) {
            console.log(
              `      ->  Downloaded image  ${imagePath} is zero bytes!`
            );
            imagePath = "";
            metadata.imageStatus = "FAILED";
            metadata.thumbnail = "";
          }
        }
      }
    }
    this.saveSongMetadata(metadata,true);
    this.saveMainMetadataFile();
  }
  async embedMetadataInFile(metadata: ISongData) {
    console.log(
      `      -> Embedding metadata into converted files for ${metadata.clipId}`
    );
    // Implement embedding metadata into audio files here
    if (!AppConfig.embedMetadataInCovertedFiles) {
      return;
    }
    if (
      AppConfig.audioFormats.includes("flac") &&
      metadata.flacStatus === "CREATED"
    ) {
      await this.embedMetadataInFlac(metadata);
    }
    if (
      (AppConfig.audioFormats.includes("mp3") &&
        metadata.mp3Status === "DOWNLOADED") ||
      metadata.mp3Status === "CREATED"
    ) {
      await this.embedMetadataInMp3(metadata);
    }

    if (
      AppConfig.audioFormats.includes("alac") &&
      metadata.alacStatus === "CREATED"
    ) {
      await this.embedMetadataInAlac(metadata);
    }
    console.log(
      `      <- Done embedding metadata into converted files for ${metadata.clipId}`
    );
  }
  private cleanFlacMetadata(data: string | null | undefined): string {
    if (data === null || data === undefined) {
      return "";
    }
    return data.replaceAll("\n", "").replaceAll(os.EOL, "");
  }
  private checkedDateToString(date: Date | undefined | null): string {
    let dateStr: string;
    try {
      dateStr = date ? date.toISOString() : "";
    } catch (err) {
      dateStr = new Date(Date.now()).toISOString();
    }
    return dateStr;
  }
  private async embedMetadataInFlac(metadata: ISongData) {
    const flacPath = `${AppConfig.flacDirectoryPath}/${metadata.clipId}.flac`;
    console.log(`      -> Embedding metadata into ${flacPath}`);
    //convert metadata JSON to k=v form and save as id_vorbis.txt

    let lines: string[] = [];
    lines.push(`TITLE=${this.cleanFlacMetadata(metadata.title)}`);
    lines.push(`ARTIST=${this.cleanFlacMetadata(metadata.artistName)}`);
    lines.push(`AI_MODEL=Suno ${this.cleanFlacMetadata(metadata.model)}`);
    lines.push(
      `DATE=${this.cleanFlacMetadata(
        this.checkedDateToString(metadata.creationDate)
      )}`
    );
    lines.push(`CONTACT=${this.cleanFlacMetadata(metadata.songUrl)}`);
    lines.push(`SUNO_ID=${this.cleanFlacMetadata(metadata.clipId)}`);
    lines.push(
      `DESCRIPTION=${this.cleanFlacMetadata(metadata.style ?? "-N/A-")}`
    );
    lines.push(`FAVORITE=${metadata.liked}`);
    if (metadata.tags) {
      lines.push(
        `SUNO_TAGS=${this.cleanFlacMetadata(metadata.tags.join(","))}`
      );
    }
    lines.push(`SUNO_WEIRDNESS=${metadata.weirdness}%`);
    lines.push(`SUNO_STYLE_STRENGTH=${metadata.styleStrength}%`);
    lines.push(`SUNO_AUDIO_STRENGTH=${metadata.audioStrength}%`);
    lines.push(
      `COMMENT=${this.cleanFlacMetadata(this.commentTagMunger(metadata))}`
    );
    if (metadata.remixParent) {
      lines.push(
        `SUNO_REMIX_PARENT=${this.cleanFlacMetadata(metadata.remixParent)}`
      );
    }

    const tmpFilePath = path.join(
      AppConfig.downloadRootDirectoryPath,
      "metadata",
      `${metadata.clipId}_vorbis.txt`
    );

    fs.writeFileSync(tmpFilePath, lines.join(os.EOL));
    let embeddedImage: boolean = false;
    let imagePath: string = "";
    if (
      AppConfig.embedImagesInConvertedFiles &&
      metadata.imageStatus !== "FAILED" &&
      metadata.thumbnail !== ""
    ) {
      embeddedImage = true;
      imagePath = path.join(
        //@ts-ignore
        AppConfig.imagesDirectoryPath,
        //@ts-ignore
        `${metadata.clipId}${path.extname(metadata.thumbnail)}`
      );
      if (fs.existsSync(imagePath)) {
        embeddedImage = true;
      }
    }
    const metadataArgs: string[] = [
      `--preserve-modtime`,
      `--no-utf8-convert`,
      `--import-tags-from=${tmpFilePath}`,
    ];
    if (AppConfig.embedLyricsInMetadata) {
      if (metadata.lyrics) {
        const lyricsFilePath = path.join(
          AppConfig.downloadRootDirectoryPath,
          "lyrics",
          `${metadata.clipId}.txt`
        );
        metadataArgs.push(`--set-tag-from-file=LYRICS=${lyricsFilePath}`);
      }
    }
    if (embeddedImage) {
      metadataArgs.push(`--import-picture-from=${imagePath}`);
    }
    metadataArgs.push(flacPath);
    console.log(
      `      ->  running metaflac with command: metaflac ${metadataArgs.join(
        " "
      )}`
    );
    await execFileAsync("metaflac", metadataArgs);
    fs.rmSync(tmpFilePath);
    console.log(`      <- Done embedding metadata into ${flacPath}`);
  }

  private async embedMetadataInAlac(metadata: ISongData) {
    const alacPath = `${AppConfig.alacDirectoryPath}/${metadata.clipId}.m4a`;
    console.log(`      -> Embedding metadata into ${alacPath}`);
    let parsleyArgs: string[] = [
      alacPath,
      "-W",
      "--artist",
      metadata.artistName ?? "Unknown Artist",
      "--title",
      metadata.title ?? "Untitled",
      "--year",
      this.checkedDateToString(metadata.creationDate),
      "--description",
      metadata.style ?? "[No Prompt]",
      "--comment",
      this.commentTagMunger(metadata),
    ];

    parsleyArgs = [
      ...parsleyArgs,
      ...this.createMetaCustomAtomAlac(
        "AMDL",
        "text",
        `Suno ${metadata.model}`,
        "AIModel"
      ),
      ...this.createMetaCustomAtomAlac(
        "SURL",
        "text",
        metadata.songUrl,
        "SongURL"
      ),
      ...this.createMetaCustomAtomAlac(
        "SCID",
        "text",
        metadata.clipId,
        "SunoSongID"
      ),
      ...this.createMetaCustomAtomAlac(
        "SLIK",
        "text",
        String(metadata.liked),
        "SunoLiked"
      ),
      ...this.createMetaCustomAtomAlac(
        "SWED",
        "text",
        `${metadata.weirdness}%`,
        "SunoWeirdness"
      ),
      ...this.createMetaCustomAtomAlac(
        "SSST",
        "text",
        `${metadata.styleStrength}%`,
        "SunoStyleStrength"
      ),
      ...this.createMetaCustomAtomAlac(
        "SAST",
        "text",
        `${metadata.audioStrength}%`,
        "SunoAudioStrength"
      ),
    ];

    if (metadata.tags) {
      parsleyArgs = [
        ...parsleyArgs,
        ...this.createMetaCustomAtomAlac(
          "STAG",
          "text",
          `${metadata.tags}`,
          "SunoTags"
        ),
      ];
    }
    if (metadata.remixParent) {
      parsleyArgs = [
        ...parsleyArgs,
        ...this.createMetaCustomAtomAlac(
          "SRMX",
          "text",
          `${metadata.remixParent}`,
          "SunoRemixParent"
        ),
      ];
    }
    if (AppConfig.embedLyricsInMetadata) {
      const lyricsFilePath = path.join(
        AppConfig.downloadRootDirectoryPath,
        "lyrics",
        `${metadata.clipId}.txt`
      );
      parsleyArgs = [...parsleyArgs, "--lyricsFile", lyricsFilePath];
    }
    if (
      AppConfig.embedImagesInConvertedFiles &&
      metadata.imageStatus !== "FAILED" &&
      metadata.thumbnail !== ""
    ) {
      const imagePath = path.join(
        //@ts-ignore
        AppConfig.imagesDirectoryPath,
        //@ts-ignore
        `${metadata.clipId}${path.extname(metadata.thumbnail)}`
      );

      if (fs.existsSync(imagePath)) {
        parsleyArgs = [...parsleyArgs, "--artwork", imagePath];
      }
    }
    console.log(
      `      ->  running atomic parsley with command: atomicparsley ${parsleyArgs.join(
        " "
      )}`
    );
    await execFileAsync("atomicparsley", parsleyArgs);

    const kid3JsonPath = path.join(
      AppConfig.downloadRootDirectoryPath,
      "flac",
      `${metadata.clipId}.json`
    );

    console.log(`      <- Done embedding metadata into ${alacPath}`);
  }
  private createMetaCustomAtomAlac(
    atomName: string,
    argType: "text" | "file",
    value: string,
    fullName: string
  ): string[] {
    return [
      "--rDNSatom",
      `"${value}"`,
      `name=${fullName}`,
      "domain=com.apple.iTunes",
      "--meta-uuid",
      atomName,
      argType,
      `"${value}"`,
    ];
  }
  private createKid3FileCmd(
    commandType: string,
    path: string,
    label: string
  ): string[] {
    return this.createKid3CliCommandAsArgs(
      `set ${commandType}:'${path}' '${label}'`
    );
  }
  replacer(value: string): string {
    let retval = value.replaceAll(`'`, `\\'`);
    return retval;
  }
  private createKid3Cmd(fieldName: string, value: string): string[] {
    return this.createKid3CliCommandAsArgs(
      `set ${fieldName} '${this.replacer(value)}'`
    );
  }
  private createKid3CustomFieldCommands(
    fieldName: string,
    value: string
  ): string[] {
    return [
      ...this.createKid3CliCommandAsArgs(
        `set comment '${this.replacer(value)}'`
      ),
      ...this.createKid3CliCommandAsArgs(
        `set comment.description '${fieldName}'`
      ),
    ];
  }
  private createKid3CliCommandAsArgs(command: string): string[] {
    return ["-c", `${command}`];
  }
  private async embedMetadataInMp3(metadata: ISongData) {
    const mp3Path = `${AppConfig.mp3DirectoryPath}/${metadata.clipId}.mp3`;
    console.log(`      -> Embedding metadata into ${mp3Path}`);

    const title = metadata.title ?? "Untitled";
    const artist = metadata.artistName ?? "Unknown Artist";
    const year = this.checkedDateToString(metadata.creationDate);
    const description = metadata.style ?? "[No Prompt]";
    const comment = this.commentTagMunger(metadata);
    const website = metadata.songUrl; //WWW Audio File
    const liked = metadata.liked;
    const ai_model = `Suno ${metadata.model}`;
    const tags = metadata.tags ? metadata.tags.join(",") : "";
    const weirdness = `${metadata.weirdness}%`;
    const style_strength = `${metadata.styleStrength}%`;
    const audio_strength = `${metadata.audioStrength}%`;
    const remix_parent_id = metadata.remixParent ?? "";
    const suno_song_id = metadata.clipId ?? "";
    let kid3Cmds: string[] = [
      ...this.createKid3Cmd("title", title),
      ...this.createKid3Cmd("artist", artist),
      ...this.createKid3Cmd("year", year),
      ...this.createKid3Cmd("date", year),
      ...this.createKid3Cmd("description", description),
      ...this.createKid3Cmd("WOAF", website),
      ...this.createKid3CustomFieldCommands("liked", liked ? "true" : "false"),
      ...this.createKid3CustomFieldCommands("ai_model", ai_model),
      ...this.createKid3CustomFieldCommands("tags", tags),
      ...this.createKid3CustomFieldCommands("weirdness", weirdness),
      ...this.createKid3CustomFieldCommands("style_strength", style_strength),
      ...this.createKid3CustomFieldCommands("audio_strength", audio_strength),
      ...this.createKid3CustomFieldCommands("remix_parent_id", remix_parent_id),
      ...this.createKid3CustomFieldCommands("suno_song_id", suno_song_id),
      ...this.createKid3Cmd("comment", comment),
    ];

    if (AppConfig.embedLyricsInMetadata) {
      const lyricsPath = path.join(
        AppConfig.downloadRootDirectoryPath,
        "lyrics",
        `${metadata.clipId}.txt`
      );
      kid3Cmds = [
        ...kid3Cmds,
        ...this.createKid3FileCmd("USLT", lyricsPath, "Lyrics Description"),
      ];
    }
    if (AppConfig.embedImagesInConvertedFiles) {
      if (AppConfig.embedImagesInConvertedFiles) {
        //@ts-ignore
        const imageFile = `${metadata.clipId}${path.extname(
          metadata.thumbnail ?? ""
        )}`;
        const imagePath = path.join(
          //@ts-ignore
          AppConfig.imagesDirectoryPath,
          //@ts-ignore
          imageFile
        );

        if (fs.existsSync(imagePath)) {
          kid3Cmds = [
            ...kid3Cmds,
            ...this.createKid3FileCmd(
              "picture",
              imagePath,
              "Picture Description"
            ),
          ];
        }
      }
      kid3Cmds = [
        ...kid3Cmds,
        ...this.createKid3CliCommandAsArgs("save"),
        mp3Path,
      ];

      console.log(`      ->  running kid3-cli`);
      console.log(`      ->  sending kid3-cli ${kid3Cmds.join(" ")}`);
      await execFileAsync("kid3-cli", kid3Cmds);
    }

    if (
      AppConfig.embedImagesInConvertedFiles &&
      metadata.imageStatus !== "FAILED" &&
      metadata.thumbnail !== ""
    ) {
    }
  }

  private commentTagMunger(metadata: ISongData): string {
    const commentArr: string[] = [
      `Liked:${metadata.liked ? "Yes" : "No"}`,
      `Model:Suno ${metadata.model}`,
      `Prompt:${metadata.style ?? "-N/A-"}`,
      `Weirdness:${metadata.weirdness}%`,
      `StyleStrength:${metadata.styleStrength}%`,
      `AudioStrength:${metadata.audioStrength}%`,
      `Tags:${metadata.tags ? metadata.tags.join(",") : ""}`,
    ];
    return commentArr.join("|");
  }
}
export let MetadataProcessor = new MetadataHandler();
