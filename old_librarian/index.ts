#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { AppConfig } from "./ConfigHandler.js";
import { Importer } from "./scraper.js";
import { ISongData } from "./ISongData.js";
import { Converter } from "./FileHandler.js";
import yargs from "yargs/yargs";
import { MetadataProcessor } from "./MetadataHandler.js";
const argv = yargs(process.argv.slice(2)).parseSync();

// A helper function for creating pauses

class Initializer {
  constructor() {
    this.setupDownloadDirs();
    this.SetupCopyDirs();
  }
  setupDownloadDirs() {
    const downloadRootDirectory = path.resolve(
      AppConfig.downloadRootDirectoryPath
    );
    if (!fs.existsSync(downloadRootDirectory)) {
      fs.mkdirSync(downloadRootDirectory, { recursive: true });
    }
    AppConfig.audioFormats.forEach((format) => {
      const formatDir = path.join(downloadRootDirectory, format);
      if (!fs.existsSync(formatDir)) {
        fs.mkdirSync(formatDir, { recursive: true });
      }
      (AppConfig as any)[`${format}DirectoryPath`] = formatDir;
    });
    if (AppConfig.saveMetadataSidecarFiles) {
      const metadataDir = path.join(downloadRootDirectory, "metadata");
      if (!fs.existsSync(metadataDir)) {
        fs.mkdirSync(metadataDir, { recursive: true });
      }
      AppConfig.metadataDirectoryPath = metadataDir;
    }
    if (AppConfig.saveImages) {
      const imagesDir = path.join(downloadRootDirectory, "images");
      if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
      }
      AppConfig.imagesDirectoryPath = imagesDir;
    }
    if (AppConfig.embedLyricsInMetadata || AppConfig.saveLyricsInTextFiles) {
      const lyricsDir = path.join(downloadRootDirectory, "lyrics");
      if (!fs.existsSync(lyricsDir)) {
        fs.mkdirSync(lyricsDir, { recursive: true });
      }
      AppConfig.lyricsDirectoryPath = lyricsDir;
    }
  }
  SetupCopyDirs() {
    if (AppConfig.copyDownloadsToOtherLocation) {
      AppConfig.otherLocationConfig.forEach((copyConfig) => {
        copyConfig.formats.forEach((format) => {
          const formatDir = path.join(copyConfig.directoryPath, format);
          if (!fs.existsSync(formatDir)) {
            fs.mkdirSync(formatDir, { recursive: true });
          }
        });
        if (AppConfig.saveImages) {
          const imagesDir = path.join(copyConfig.directoryPath, "images");
          if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
          }
        }
        if (AppConfig.saveMetadataSidecarFiles) {
          const metadataDir = path.join(copyConfig.directoryPath, "metadata");
          if (!fs.existsSync(metadataDir)) {
            fs.mkdirSync(metadataDir, { recursive: true });
          }
        }
        if (
          AppConfig.embedLyricsInMetadata ||
          AppConfig.saveLyricsInTextFiles
        ) {
          const lyricsDir = path.join(copyConfig.directoryPath, "lyrics");
          if (!fs.existsSync(lyricsDir)) {
            fs.mkdirSync(lyricsDir, { recursive: true });
          }
        }
      });
    }
  }
}

async function dostart() {if (argv.clean){
    console.log("****Cleaning download directorys****");
    const downloadRootDirectory = path.resolve(
      AppConfig.downloadRootDirectoryPath
    );
    fs.rmSync(downloadRootDirectory, {recursive:true, force:true});
  }
  let AppInitializer = new Initializer();
  if (argv.processOnly){
    await processOnly();
    console.log("****Done running converters. Exiting.****")
    return;
  }
 
  await Importer.Initialize();
  await Importer.scrapeAndDownload();
}
async function processOnly() {
  console.log("****Starting in process only mode****");
  const metadataPath = path.join(
    AppConfig.downloadRootDirectoryPath,
    "metadata"
  );
  let metadataFiles = fs.readdirSync(metadataPath);
  for (const mdataFile of metadataFiles) {
    if (!mdataFile.includes(AppConfig.combinedSongsMetadataJsonFile) && mdataFile.endsWith(".json")) {
      const filePath = path.join(metadataPath, mdataFile);
      const metaInfo = JSON.parse(
        fs.readFileSync(filePath, { encoding: "utf-8" }),MetadataProcessor.dateReviver
      ) as ISongData;
      await Converter.convertWav(metaInfo);
    }
  }
}
dostart();
