import { TFileStatus } from "./TFileStatus";

export interface ISongData {
  title?: string|null;
  clipId: string;
  style?: string|null;
  thumbnail?: string|null;
  model?: string|null;
  duration?: string|null;
  mp3Status?: TFileStatus;
  flacStatus?: TFileStatus;
  alacStatus?: TFileStatus;
  wavStatus?: TFileStatus;
  imageStatus?:TFileStatus;
  songUrl: string;
  liked: boolean;
  artistName?: string|null;
  lyrics?: string|undefined;
  creationDate?: Date|null;
  weirdness: number;
  styleStrength:number;
  audioStrength:number;
  remixParent?:string|undefined;
  tags?: string[];
  comment?:string;
}
