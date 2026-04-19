import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { DEFAULT_DATABASE_PATH } from "./cli-defaults";
import type { ISongData, ITrackProject, IWorkspace } from "./lib/interfaces";
import { normalizeMetadata } from "./lib/metadata/normalize-metadata";

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS songs (
  clip_id TEXT PRIMARY KEY,
  sort_index INTEGER NOT NULL,
  title TEXT,
  song_url TEXT NOT NULL,
  style TEXT,
  thumbnail TEXT,
  model TEXT,
  duration TEXT,
  liked INTEGER NOT NULL DEFAULT 0,
  artist_name TEXT,
  lyrics TEXT,
  creation_date TEXT,
  weirdness REAL,
  style_strength REAL,
  audio_strength REAL,
  remix_parent TEXT,
  comment TEXT,
  upload INTEGER,
  is_hidden INTEGER,
  gpt_description_prompt TEXT,
  persona_id TEXT,
  persona_name TEXT,
  project_name TEXT,
  explicit INTEGER,
  flagged_reason TEXT,
  mp3_status TEXT,
  wav_status TEXT,
  alac_status TEXT,
  flac_status TEXT,
  image_status TEXT,
  mp3_timestamp TEXT,
  wav_timestamp TEXT,
  alac_timestamp TEXT,
  flac_timestamp TEXT,
  raw_api_response_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_songs_sort_index ON songs(sort_index);
CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title);
CREATE INDEX IF NOT EXISTS idx_songs_creation_date ON songs(creation_date);
CREATE INDEX IF NOT EXISTS idx_songs_artist_name ON songs(artist_name);
CREATE INDEX IF NOT EXISTS idx_songs_project_name ON songs(project_name);

CREATE TABLE IF NOT EXISTS song_tags (
  clip_id TEXT NOT NULL,
  sort_index INTEGER NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (clip_id, sort_index),
  FOREIGN KEY (clip_id) REFERENCES songs(clip_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_song_tags_tag ON song_tags(tag);

CREATE TABLE IF NOT EXISTS song_negative_tags (
  clip_id TEXT NOT NULL,
  sort_index INTEGER NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (clip_id, sort_index),
  FOREIGN KEY (clip_id) REFERENCES songs(clip_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_song_negative_tags_tag ON song_negative_tags(tag);

CREATE TABLE IF NOT EXISTS song_mashup_sources (
  clip_id TEXT NOT NULL,
  sort_index INTEGER NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (clip_id, sort_index),
  FOREIGN KEY (clip_id) REFERENCES songs(clip_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_trashed INTEGER NOT NULL DEFAULT 0,
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workspaces_name ON workspaces(name);

CREATE TABLE IF NOT EXISTS song_workspaces (
  clip_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'metadata',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (clip_id, workspace_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_song_workspaces_workspace_id
ON song_workspaces(workspace_id);
`;

export interface MetadataStore {
  readonly location: string;
  loadAll(): Promise<ISongData[]>;
  saveAll(songs: ISongData[]): Promise<void>;
  upsert(song: ISongData): Promise<void>;
  upsertWorkspaces(workspaces: IWorkspace[]): Promise<void>;
  upsertSongWorkspace(clipId: string, workspace: IWorkspace, source?: string): Promise<void>;
  exists(): Promise<boolean>;
  close(): void;
}

function dateReviver(_key: string, value: any): any {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(value)) {
    return new Date(value);
  }
  return value;
}

function dateToDb(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function dateFromDb(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function boolToDb(value: boolean | null | undefined): number | null {
  if (value == null) return null;
  return value ? 1 : 0;
}

function boolFromDb(value: number | null | undefined, defaultValue?: boolean): boolean | undefined {
  if (value == null) return defaultValue;
  return value === 1;
}

function optionalJsonParse<T>(value: string | null | undefined): T | undefined {
  if (!value) return undefined;
  return JSON.parse(value, dateReviver) as T;
}

function readJsonArray(filePath: string): ISongData[] {
  const raw = fs.readFileSync(filePath, "utf-8");
  if (!raw.trim()) return [];
  const parsed = JSON.parse(raw, dateReviver);
  return Array.isArray(parsed) ? parsed.map((entry) => normalizeMetadata(entry)) : [];
}

export function writeMetadataJsonFile(filePath: string, songs: ISongData[]): void {
  const tmp = `${filePath}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(songs.map((song) => normalizeMetadata(song)), null, 2));
  fs.renameSync(tmp, filePath);
}

export function resolveDatabasePath(databasePath?: string): string {
  return databasePath && databasePath.trim().length > 0
    ? path.resolve(databasePath.trim())
    : DEFAULT_DATABASE_PATH;
}

export async function importMetadataJsonToDatabase(
  jsonFilePath: string,
  databasePath?: string,
): Promise<{ imported: number; databasePath: string }> {
  const resolvedJsonPath = path.resolve(jsonFilePath);
  const songs = readJsonArray(resolvedJsonPath);
  const store = new SqliteMetadataStore(resolveDatabasePath(databasePath));
  try {
    await store.saveAll(songs);
  } finally {
    store.close();
  }
  return { imported: songs.length, databasePath: store.location };
}

export async function exportMetadataDatabaseToJson(
  jsonFilePath: string,
  databasePath?: string,
): Promise<{ exported: number; databasePath: string; jsonFilePath: string }> {
  const resolvedJsonPath = path.resolve(jsonFilePath);
  const store = new SqliteMetadataStore(resolveDatabasePath(databasePath));
  try {
    const songs = await store.loadAll();
    writeMetadataJsonFile(resolvedJsonPath, songs);
    return {
      exported: songs.length,
      databasePath: store.location,
      jsonFilePath: resolvedJsonPath,
    };
  } finally {
    store.close();
  }
}

export class SqliteMetadataStore implements MetadataStore {
  readonly location: string;
  private db: Database.Database;
  private insertSongStatement: Database.Statement;
  private insertTagStatement: Database.Statement;
  private insertNegativeTagStatement: Database.Statement;
  private insertMashupSourceStatement: Database.Statement;
  private upsertWorkspaceStatement: Database.Statement;
  private upsertSongWorkspaceStatement: Database.Statement;

  constructor(databasePath: string = DEFAULT_DATABASE_PATH) {
    this.location = path.resolve(databasePath);
    fs.mkdirSync(path.dirname(this.location), { recursive: true });

    this.db = new Database(this.location);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(SQLITE_SCHEMA);
    this.ensureWorkspaceColumns();
    this.insertSongStatement = this.db.prepare(`
      INSERT INTO songs (
        clip_id, sort_index, title, song_url, style, thumbnail, model, duration,
        liked, artist_name, lyrics, creation_date, weirdness, style_strength,
        audio_strength, remix_parent, comment, upload, is_hidden,
        gpt_description_prompt, persona_id, persona_name, project_name, explicit,
        flagged_reason, mp3_status, wav_status, alac_status, flac_status,
        image_status, mp3_timestamp, wav_timestamp, alac_timestamp,
        flac_timestamp, raw_api_response_json, updated_at
      )
      VALUES (
        @clipId, @sortIndex, @title, @songUrl, @style, @thumbnail, @model, @duration,
        @liked, @artistName, @lyrics, @creationDate, @weirdness, @styleStrength,
        @audioStrength, @remixParent, @comment, @upload, @isHidden,
        @gptDescriptionPrompt, @personaId, @personaName, @projectName, @explicit,
        @flaggedReason, @mp3Status, @wavStatus, @alacStatus, @flacStatus,
        @imageStatus, @mp3Timestamp, @wavTimestamp, @alacTimestamp,
        @flacTimestamp, @rawApiResponseJson, CURRENT_TIMESTAMP
      )
      ON CONFLICT(clip_id) DO UPDATE SET
        sort_index = excluded.sort_index,
        title = excluded.title,
        song_url = excluded.song_url,
        style = excluded.style,
        thumbnail = excluded.thumbnail,
        model = excluded.model,
        duration = excluded.duration,
        liked = excluded.liked,
        artist_name = excluded.artist_name,
        lyrics = excluded.lyrics,
        creation_date = excluded.creation_date,
        weirdness = excluded.weirdness,
        style_strength = excluded.style_strength,
        audio_strength = excluded.audio_strength,
        remix_parent = excluded.remix_parent,
        comment = excluded.comment,
        upload = excluded.upload,
        is_hidden = excluded.is_hidden,
        gpt_description_prompt = excluded.gpt_description_prompt,
        persona_id = excluded.persona_id,
        persona_name = excluded.persona_name,
        project_name = excluded.project_name,
        explicit = excluded.explicit,
        flagged_reason = excluded.flagged_reason,
        mp3_status = excluded.mp3_status,
        wav_status = excluded.wav_status,
        alac_status = excluded.alac_status,
        flac_status = excluded.flac_status,
        image_status = excluded.image_status,
        mp3_timestamp = excluded.mp3_timestamp,
        wav_timestamp = excluded.wav_timestamp,
        alac_timestamp = excluded.alac_timestamp,
        flac_timestamp = excluded.flac_timestamp,
        raw_api_response_json = excluded.raw_api_response_json,
        updated_at = CURRENT_TIMESTAMP
    `);
    this.insertTagStatement = this.db.prepare(
      "INSERT INTO song_tags (clip_id, sort_index, tag) VALUES (?, ?, ?)",
    );
    this.insertNegativeTagStatement = this.db.prepare(
      "INSERT INTO song_negative_tags (clip_id, sort_index, tag) VALUES (?, ?, ?)",
    );
    this.insertMashupSourceStatement = this.db.prepare(
      "INSERT INTO song_mashup_sources (clip_id, sort_index, source) VALUES (?, ?, ?)",
    );
    this.upsertWorkspaceStatement = this.db.prepare(`
      INSERT INTO workspaces (
        id, name, description, is_trashed, is_public, updated_at, last_seen_at
      )
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        is_trashed = excluded.is_trashed,
        is_public = excluded.is_public,
        updated_at = CURRENT_TIMESTAMP,
        last_seen_at = CURRENT_TIMESTAMP
    `);
    this.upsertSongWorkspaceStatement = this.db.prepare(`
      INSERT INTO song_workspaces (clip_id, workspace_id, source, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(clip_id, workspace_id) DO UPDATE SET
        source = excluded.source,
        updated_at = CURRENT_TIMESTAMP
    `);
    this.migrateLegacyMetadataEntries();
  }

  async exists(): Promise<boolean> {
    return fs.existsSync(this.location);
  }

  async loadAll(): Promise<ISongData[]> {
    const rows = this.db
      .prepare("SELECT * FROM songs ORDER BY sort_index ASC, clip_id ASC")
      .all() as any[];
    return rows.map((row) => normalizeMetadata(this.rowToSong(row)));
  }

  async saveAll(songs: ISongData[]): Promise<void> {
    const normalizedSongs = songs.map((song) => normalizeMetadata(song));

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM songs").run();
      normalizedSongs.forEach((song, index) => {
        this.writeSong(song, index);
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async upsert(song: ISongData): Promise<void> {
    const normalizedSong = normalizeMetadata(song);
    const currentMax = this.db
      .prepare("SELECT COALESCE(MAX(sort_index), -1) AS max_index FROM songs")
      .get() as { max_index: number };
    const existing = this.db
      .prepare("SELECT sort_index FROM songs WHERE clip_id = ?")
      .get(normalizedSong.clipId) as { sort_index: number } | undefined;
    const sortIndex = existing?.sort_index ?? currentMax.max_index + 1;

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.writeSong(normalizedSong, sortIndex);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async upsertWorkspaces(workspaces: IWorkspace[]): Promise<void> {
    const save = this.db.transaction((workspaceRows: IWorkspace[]) => {
      workspaceRows.forEach((workspace) => {
        this.writeWorkspace(workspace);
      });
    });
    save(workspaces);
  }

  async upsertSongWorkspace(
    clipId: string,
    workspace: IWorkspace,
    source: string = "discovery",
  ): Promise<void> {
    const save = this.db.transaction(() => {
      this.writeWorkspace(workspace);
      this.upsertSongWorkspaceStatement.run(clipId, workspace.id, source);
    });
    save();
  }

  close(): void {
    this.db.close();
  }

  private migrateLegacyMetadataEntries(): void {
    const legacyTable = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'metadata_entries'")
      .get();
    if (!legacyTable) return;

    const songCount = this.db.prepare("SELECT COUNT(*) AS count FROM songs").get() as { count: number };
    if (songCount.count > 0) return;

    const legacyRows = this.db
      .prepare("SELECT sort_index, metadata_json FROM metadata_entries ORDER BY sort_index ASC, clip_id ASC")
      .all() as Array<{ sort_index: number; metadata_json: string }>;
    if (legacyRows.length === 0) return;

    const migrate = this.db.transaction((rows: Array<{ sort_index: number; metadata_json: string }>) => {
      rows.forEach((row, index) => {
        const song = normalizeMetadata(JSON.parse(row.metadata_json, dateReviver));
        this.writeSong(song, row.sort_index ?? index);
      });
    });
    migrate(legacyRows);
  }

  private ensureWorkspaceColumns(): void {
    const columns = this.db.prepare("PRAGMA table_info(workspaces)").all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));
    const addColumn = (definition: string) => {
      this.db.exec(`ALTER TABLE workspaces ADD COLUMN ${definition}`);
    };

    if (!columnNames.has("description")) addColumn("description TEXT");
    if (!columnNames.has("is_trashed")) addColumn("is_trashed INTEGER NOT NULL DEFAULT 0");
    if (!columnNames.has("is_public")) addColumn("is_public INTEGER NOT NULL DEFAULT 0");
  }

  private writeSong(song: ISongData, sortIndex: number): void {
    this.insertSongStatement.run(this.songToRow(song, sortIndex));
    this.db.prepare("DELETE FROM song_tags WHERE clip_id = ?").run(song.clipId);
    this.db.prepare("DELETE FROM song_negative_tags WHERE clip_id = ?").run(song.clipId);
    this.db.prepare("DELETE FROM song_mashup_sources WHERE clip_id = ?").run(song.clipId);

    (song.tags || []).forEach((tag, index) => {
      this.insertTagStatement.run(song.clipId, index, tag);
    });
    (song.negativeTags || []).forEach((tag, index) => {
      this.insertNegativeTagStatement.run(song.clipId, index, tag);
    });
    (song.mashupSource || []).forEach((source, index) => {
      this.insertMashupSourceStatement.run(song.clipId, index, source);
    });

    const project = song.rawApiResponse?.project;
    if (project) {
      this.writeWorkspace(project);
      this.upsertSongWorkspaceStatement.run(song.clipId, project.id, "metadata");
    }
  }

  private writeWorkspace(workspace: ITrackProject): void {
    this.upsertWorkspaceStatement.run(
      workspace.id,
      workspace.name,
      workspace.description ?? null,
      workspace.is_trashed ? 1 : 0,
      workspace.is_public ? 1 : 0,
    );
  }

  private songToRow(song: ISongData, sortIndex: number): Record<string, any> {
    return {
      clipId: song.clipId,
      sortIndex,
      title: song.title ?? null,
      songUrl: song.songUrl,
      style: song.style ?? null,
      thumbnail: song.thumbnail ?? null,
      model: song.model ?? null,
      duration: song.duration ?? null,
      liked: song.liked ? 1 : 0,
      artistName: song.artistName ?? null,
      lyrics: song.lyrics ?? null,
      creationDate: dateToDb(song.creationDate),
      weirdness: song.weirdness ?? null,
      styleStrength: song.styleStrength ?? null,
      audioStrength: song.audioStrength ?? null,
      remixParent: song.remixParent ?? null,
      comment: song.comment ?? null,
      upload: boolToDb(song.upload),
      isHidden: boolToDb(song.isHidden),
      gptDescriptionPrompt: song.gptDescriptionPrompt ?? null,
      personaId: song.personaId ?? null,
      personaName: song.personaName ?? null,
      projectName: song.projectName ?? null,
      explicit: boolToDb(song.explicit),
      flaggedReason: song.flaggedReason ?? null,
      mp3Status: song.mp3Status ?? null,
      wavStatus: song.wavStatus ?? null,
      alacStatus: song.alacStatus ?? null,
      flacStatus: song.flacStatus ?? null,
      imageStatus: song.imageStatus ?? null,
      mp3Timestamp: dateToDb(song.mp3Timestamp),
      wavTimestamp: dateToDb(song.wavTimestamp),
      alacTimestamp: dateToDb(song.alacTimestamp),
      flacTimestamp: dateToDb(song.flacTimestamp),
      rawApiResponseJson: song.rawApiResponse ? JSON.stringify(song.rawApiResponse) : null,
    };
  }

  private rowToSong(row: any): ISongData {
    const tags = this.getStringChildren("song_tags", "tag", row.clip_id);
    const negativeTags = this.getStringChildren("song_negative_tags", "tag", row.clip_id);
    const mashupSource = this.getStringChildren("song_mashup_sources", "source", row.clip_id);

    const song: ISongData = {
      title: row.title,
      clipId: row.clip_id,
      songUrl: row.song_url,
      style: row.style,
      thumbnail: row.thumbnail,
      model: row.model,
      duration: row.duration,
      liked: boolFromDb(row.liked, false) ?? false,
      artistName: row.artist_name,
      lyrics: row.lyrics ?? undefined,
      creationDate: dateFromDb(row.creation_date),
      weirdness: row.weirdness,
      styleStrength: row.style_strength,
      audioStrength: row.audio_strength,
      remixParent: row.remix_parent ?? undefined,
      comment: row.comment ?? undefined,
      upload: boolFromDb(row.upload),
      negativeTags,
      isHidden: boolFromDb(row.is_hidden),
      gptDescriptionPrompt: row.gpt_description_prompt,
      mashupSource,
      personaId: row.persona_id,
      personaName: row.persona_name,
      projectName: row.project_name,
      explicit: boolFromDb(row.explicit),
      flaggedReason: row.flagged_reason,
      mp3Status: row.mp3_status ?? undefined,
      wavStatus: row.wav_status ?? undefined,
      alacStatus: row.alac_status ?? undefined,
      flacStatus: row.flac_status ?? undefined,
      imageStatus: row.image_status ?? undefined,
      mp3Timestamp: dateFromDb(row.mp3_timestamp),
      wavTimestamp: dateFromDb(row.wav_timestamp),
      alacTimestamp: dateFromDb(row.alac_timestamp),
      flacTimestamp: dateFromDb(row.flac_timestamp),
      tags,
      rawApiResponse: optionalJsonParse(row.raw_api_response_json),
    };

    return song;
  }

  private getStringChildren(tableName: string, valueColumn: string, clipId: string): string[] {
    const rows = this.db
      .prepare(`SELECT ${valueColumn} AS value FROM ${tableName} WHERE clip_id = ? ORDER BY sort_index ASC`)
      .all(clipId) as Array<{ value: string }>;
    return rows.map((row) => row.value);
  }
}
