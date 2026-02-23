import { IDownloadHandlingConfig } from "./IDownloadHandlingConfig";
import { TAudioFormats } from "./TAudioFormats";

export interface IAppConfig {
  downloadRootDirectoryPath: string;
  audioFormats: TAudioFormats[];
  useSunoMp3FileIfAvailable: boolean;
  convertedMp3BitrateKbps: number;
  saveImages: boolean;
  saveMetadataSidecarFiles: boolean;
  saveLyricsInTextFiles: boolean;
  combinedSongsMetadataJsonFile: string;
  embedMetadataInCovertedFiles: boolean;
  embedImagesInConvertedFiles: boolean;
  embedLyricsInMetadata: boolean;
  deleteImagesAfterEmbedding: boolean;
  deleteLyricsAfterEmbedding:boolean;
  useSongTitleInFilenames: boolean;
  chromeExecutablePath: string;
  chromeTempUserDataDirPath: string;
  copyDownloadsToOtherLocation: boolean;
  retainOriginalsAfterCopying:boolean;
  otherLocationConfig: IDownloadHandlingConfig[];
  wavDirectoryPath?: string;
  mp3DirectoryPath?: string;
  flacDirectoryPath?: string;
  alacDirectoryPath?: string;
  imagesDirectoryPath?: string;
  lyricsDirectoryPath?: string;
  metadataDirectoryPath?: string;
}
