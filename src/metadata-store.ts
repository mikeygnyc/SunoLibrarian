import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { Pool, type PoolClient } from "pg";
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
  creation_date TIMESTAMP,
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
  mp3_timestamp TIMESTAMP,
  wav_timestamp TIMESTAMP,
  alac_timestamp TIMESTAMP,
  flac_timestamp TIMESTAMP,
  raw_api_response_json TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_songs_sort_index ON songs(sort_index);
CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title);
CREATE INDEX IF NOT EXISTS idx_songs_creation_date ON songs(creation_date);
CREATE INDEX IF NOT EXISTS idx_songs_artist_name ON songs(artist_name);
CREATE INDEX IF NOT EXISTS idx_songs_project_name ON songs(project_name);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS song_tags (
  clip_id TEXT NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (clip_id, tag_id),
  FOREIGN KEY (clip_id) REFERENCES songs(clip_id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_song_tags_tag_id ON song_tags(tag_id);

CREATE TABLE IF NOT EXISTS song_negative_tags (
  clip_id TEXT NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (clip_id, tag_id),
  FOREIGN KEY (clip_id) REFERENCES songs(clip_id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_song_negative_tags_tag_id ON song_negative_tags(tag_id);

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
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workspaces_name ON workspaces(name);

CREATE TABLE IF NOT EXISTS song_workspaces (
  clip_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'metadata',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (clip_id, workspace_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_song_workspaces_workspace_id
ON song_workspaces(workspace_id);
`;

const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS songs (
  clip_id TEXT PRIMARY KEY,
  sort_index INTEGER NOT NULL,
  title TEXT,
  song_url TEXT NOT NULL,
  style TEXT,
  thumbnail TEXT,
  model TEXT,
  duration TEXT,
  liked BOOLEAN NOT NULL DEFAULT false,
  artist_name TEXT,
  lyrics TEXT,
  creation_date TIMESTAMPTZ,
  weirdness DOUBLE PRECISION,
  style_strength DOUBLE PRECISION,
  audio_strength DOUBLE PRECISION,
  remix_parent TEXT,
  comment TEXT,
  upload BOOLEAN,
  is_hidden BOOLEAN,
  gpt_description_prompt TEXT,
  persona_id TEXT,
  persona_name TEXT,
  project_name TEXT,
  explicit BOOLEAN,
  flagged_reason TEXT,
  mp3_status TEXT,
  wav_status TEXT,
  alac_status TEXT,
  flac_status TEXT,
  image_status TEXT,
  mp3_timestamp TIMESTAMPTZ,
  wav_timestamp TIMESTAMPTZ,
  alac_timestamp TIMESTAMPTZ,
  flac_timestamp TIMESTAMPTZ,
  raw_api_response_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_songs_sort_index ON songs(sort_index);
CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title);
CREATE INDEX IF NOT EXISTS idx_songs_creation_date ON songs(creation_date);
CREATE INDEX IF NOT EXISTS idx_songs_artist_name ON songs(artist_name);
CREATE INDEX IF NOT EXISTS idx_songs_project_name ON songs(project_name);

CREATE TABLE IF NOT EXISTS tags (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_normalized_name ON tags(normalized_name);

CREATE TABLE IF NOT EXISTS song_tags (
  clip_id TEXT NOT NULL,
  tag_id BIGINT NOT NULL,
  PRIMARY KEY (clip_id, tag_id),
  FOREIGN KEY (clip_id) REFERENCES songs(clip_id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_song_tags_tag_id ON song_tags(tag_id);

CREATE TABLE IF NOT EXISTS song_negative_tags (
  clip_id TEXT NOT NULL,
  tag_id BIGINT NOT NULL,
  PRIMARY KEY (clip_id, tag_id),
  FOREIGN KEY (clip_id) REFERENCES songs(clip_id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_song_negative_tags_tag_id ON song_negative_tags(tag_id);

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
  is_trashed BOOLEAN NOT NULL DEFAULT false,
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workspaces_name ON workspaces(name);

CREATE TABLE IF NOT EXISTS song_workspaces (
  clip_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'metadata',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (clip_id, workspace_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_song_workspaces_workspace_id
ON song_workspaces(workspace_id);
`;

export type MetadataDatabaseType = "sqlite" | "postgres" | "file";

export interface MetadataStoreConfig {
  type: MetadataDatabaseType;
  sqlitePath?: string;
  postgresUrl?: string;
  jsonFilePath?: string;
}

export interface MetadataStoreConfigInput {
  databaseType?: string;
  database?: string;
  postgresUrl?: string;
}

const METADATA_SCHEMA_LOCK_NAMESPACE = 2048;
const METADATA_SCHEMA_LOCK_RESOURCE = 2;

export type MetadataStoreLogger = (message: string) => void;

export interface MetadataStoreOptions {
  log?: MetadataStoreLogger;
}

export interface DownloadVerification {
  clipId: string;
  hasRawApiResponse: boolean;
  mp3Status?: string;
  wavStatus?: string;
}

function logMetadataDatabaseStatus(message: string): void {
  console.log(`[metadata-db] ${message}`);
}

export interface MetadataStore {
  readonly location: string;
  loadAll(): Promise<ISongData[]>;
  loadByClipIds(clipIds: string[]): Promise<ISongData[]>;
  loadDownloadVerifications(clipIds: string[]): Promise<DownloadVerification[]>;
  getByClipId(clipId: string): Promise<ISongData | undefined>;
  listWorkspaces(): Promise<IWorkspace[]>;
  listPendingAssetClipIds(workspaceId: string, format: "mp3" | "wav", limit?: number): Promise<string[]>;
  saveAll(songs: ISongData[]): Promise<void>;
  upsert(song: ISongData): Promise<void>;
  upsertWorkspaces(workspaces: IWorkspace[]): Promise<void>;
  upsertSongWorkspace(clipId: string, workspace: IWorkspace, source?: string): Promise<void>;
  exists(): Promise<boolean>;
  close(): Promise<void> | void;
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

function dateFromDb(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function boolToDb(value: boolean | null | undefined): number | null {
  if (value == null) return null;
  return value ? 1 : 0;
}

function boolFromDb(value: number | boolean | null | undefined, defaultValue?: boolean): boolean | undefined {
  if (value == null) return defaultValue;
  if (typeof value === "boolean") return value;
  return value === 1;
}

function optionalJsonParse<T>(value: string | null | undefined): T | undefined {
  if (!value) return undefined;
  return JSON.parse(value, dateReviver) as T;
}

function describePostgresConnection(postgresUrl: string): string {
  try {
    const url = new URL(postgresUrl);
    const auth = url.username ? `${url.username}@` : "";
    const database = url.pathname && url.pathname !== "/" ? url.pathname : "";
    return `${url.protocol}//${auth}${url.host}${database}`;
  } catch {
    return "postgres";
  }
}

function normalizeTagForIdentity(tag: string): string {
  return tag.trim().toLowerCase().replace(/[\s-]+/g, "");
}

function getTagDisplayPriority(tag: string): number {
  const trimmed = tag.trim();
  if (!trimmed) return Number.MAX_SAFE_INTEGER;
  if (!/[\s-]/.test(trimmed)) return 0;
  if (trimmed.includes("-")) return 1;
  if (/\s/.test(trimmed)) return 2;
  return 3;
}

function preferTagDisplayName(current: string, candidate: string): string {
  const currentPriority = getTagDisplayPriority(current);
  const candidatePriority = getTagDisplayPriority(candidate);
  if (candidatePriority < currentPriority) return candidate;
  return current;
}

function uniqueTagsByIdentity(tags: string[]): Array<{ name: string; normalizedName: string }> {
  const unique = new Map<string, string>();
  tags.forEach((tag) => {
    const trimmed = tag.trim();
    const key = normalizeTagForIdentity(trimmed);
    if (!key) return;

    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, trimmed);
      return;
    }

    unique.set(key, preferTagDisplayName(existing, trimmed));
  });
  return Array.from(unique.entries()).map(([normalizedName, name]) => ({ name, normalizedName }));
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

export function resolveMetadataJsonPath(filePath?: string): string {
  return filePath && filePath.trim().length > 0
    ? path.resolve(filePath.trim())
    : path.resolve("songs_metadata.json");
}

export function resolveDatabasePath(databasePath?: string): string {
  return databasePath && databasePath.trim().length > 0
    ? path.resolve(databasePath.trim())
    : DEFAULT_DATABASE_PATH;
}

export function resolveMetadataStoreConfig(input?: MetadataStoreConfigInput | string): MetadataStoreConfig {
  if (typeof input === "string") {
    return { type: "sqlite", sqlitePath: resolveDatabasePath(input) };
  }

  const requestedType = input?.databaseType?.trim().toLowerCase();
  const postgresUrl = input?.postgresUrl?.trim() || process.env.SUNO_EXPORT_POSTGRES_URL;

  if (!requestedType) {
    if (postgresUrl) {
      return { type: "postgres", postgresUrl };
    }

    throw new Error(
      [
        "Metadata database type is required when no Postgres URL is configured.",
        "Provide --database-type postgres with --postgres-url, or explicitly set --database-type sqlite.",
      ].join("\n"),
    );
  }

  if (requestedType !== "sqlite" && requestedType !== "postgres" && requestedType !== "file") {
    throw new Error("--database-type must be sqlite, postgres, or file");
  }

  if (requestedType === "postgres") {
    if (!postgresUrl) {
      throw new Error("Postgres metadata database selected; provide --postgres-url or SUNO_EXPORT_POSTGRES_URL");
    }
    return { type: "postgres", postgresUrl };
  }

  if (requestedType === "file") {
    return { type: "file", jsonFilePath: resolveMetadataJsonPath(input?.database) };
  }

  return { type: "sqlite", sqlitePath: resolveDatabasePath(input?.database) };
}

export function describeMetadataStoreConfig(config: MetadataStoreConfig): string {
  if (config.type === "postgres") {
    return describePostgresConnection(config.postgresUrl ?? "");
  }
  if (config.type === "file") {
    return resolveMetadataJsonPath(config.jsonFilePath);
  }
  return resolveDatabasePath(config.sqlitePath);
}

export async function createMetadataStore(
  config?: MetadataStoreConfig | string,
  options: MetadataStoreOptions = {},
): Promise<MetadataStore> {
  const storeOptions: MetadataStoreOptions = {
    ...options,
    log: options.log ?? logMetadataDatabaseStatus,
  };
  const resolvedConfig = typeof config === "string"
    ? resolveMetadataStoreConfig(config)
    : config ?? resolveMetadataStoreConfig();

  if (resolvedConfig.type === "postgres") {
    const store = new PostgresMetadataStore(resolvedConfig.postgresUrl, storeOptions);
    await store.initialize();
    return store;
  }

  if (resolvedConfig.type === "file") {
    return new JsonMetadataStore(resolveMetadataJsonPath(resolvedConfig.jsonFilePath), storeOptions);
  }

  return new SqliteMetadataStore(resolveDatabasePath(resolvedConfig.sqlitePath), storeOptions);
}

export class JsonMetadataStore implements MetadataStore {
  readonly location: string;
  private readonly existedBeforeOpen: boolean;
  private readonly log?: MetadataStoreLogger;

  constructor(jsonFilePath: string, options: MetadataStoreOptions = {}) {
    this.location = path.resolve(jsonFilePath);
    this.existedBeforeOpen = fs.existsSync(this.location);
    this.log = options.log ?? logMetadataDatabaseStatus;
    this.log?.(`Opening file-backed metadata store: ${this.location}`);
  }

  async exists(): Promise<boolean> {
    return this.existedBeforeOpen;
  }

  async loadAll(): Promise<ISongData[]> {
    if (!fs.existsSync(this.location)) {
      this.log?.("File-backed metadata store not found; returning empty dataset");
      return [];
    }
    const songs = readJsonArray(this.location);
    this.log?.(`Loaded ${songs.length} metadata entr${songs.length === 1 ? "y" : "ies"} from ${this.location}`);
    return songs;
  }

  async loadByClipIds(clipIds: string[]): Promise<ISongData[]> {
    const clipIdSet = new Set(clipIds);
    const songs = await this.loadAll();
    return songs.filter((song) => clipIdSet.has(song.clipId));
  }

  async loadDownloadVerifications(clipIds: string[]): Promise<DownloadVerification[]> {
    const songs = await this.loadByClipIds(clipIds);
    return songs.map((song) => ({
      clipId: song.clipId,
      hasRawApiResponse: song.rawApiResponse != null,
      mp3Status: song.mp3Status,
      wavStatus: song.wavStatus,
    }));
  }

  async getByClipId(clipId: string): Promise<ISongData | undefined> {
    const songs = await this.loadAll();
    return songs.find((song) => song.clipId === clipId);
  }

  async listWorkspaces(): Promise<IWorkspace[]> {
    return [];
  }

  async listPendingAssetClipIds(workspaceId: string, format: "mp3" | "wav", limit: number = Number.MAX_SAFE_INTEGER): Promise<string[]> {
    void workspaceId;
    void format;
    void limit;
    return [];
  }

  async saveAll(songs: ISongData[]): Promise<void> {
    writeMetadataJsonFile(this.location, songs);
    this.log?.(`Saved ${songs.length} metadata entr${songs.length === 1 ? "y" : "ies"} to ${this.location}`);
  }

  async upsert(song: ISongData): Promise<void> {
    const songs = await this.loadAll();
    const normalizedSong = normalizeMetadata(song);
    const existingIndex = songs.findIndex((entry) => entry.clipId === normalizedSong.clipId);
    if (existingIndex >= 0) {
      songs[existingIndex] = normalizedSong;
    } else {
      songs.push(normalizedSong);
    }
    await this.saveAll(songs);
  }

  async upsertWorkspaces(_workspaces: IWorkspace[]): Promise<void> {
    // The file-backed local workflow does not need a separate workspace table.
  }

  async upsertSongWorkspace(_clipId: string, _workspace: IWorkspace, _source: string = "metadata"): Promise<void> {
    // The file-backed local workflow persists song metadata only.
  }

  async close(): Promise<void> {
    this.log?.(`Closed file-backed metadata store: ${this.location}`);
  }
}

async function withPostgresAdvisoryLock<T>(
  client: PoolClient,
  namespace: number,
  resource: number,
  work: () => Promise<T>,
): Promise<T> {
  await client.query("SELECT pg_advisory_lock($1, $2)", [namespace, resource]);
  try {
    return await work();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1, $2)", [namespace, resource]);
  }
}

export async function importMetadataJsonToDatabase(
  jsonFilePath: string,
  databasePathOrConfig?: string | MetadataStoreConfig,
  options: MetadataStoreOptions = {},
): Promise<{ imported: number; databasePath: string }> {
  const log = options.log ?? logMetadataDatabaseStatus;
  const resolvedJsonPath = path.resolve(jsonFilePath);
  log(`Reading metadata JSON: ${resolvedJsonPath}`);
  const songs = readJsonArray(resolvedJsonPath);
  log(`Parsed ${songs.length} metadata entr${songs.length === 1 ? "y" : "ies"} from JSON`);
  const store = await createMetadataStore(databasePathOrConfig, options);
  try {
    log(`Writing metadata to database: ${store.location}`);
    await store.saveAll(songs);
    log(`Database write complete: imported ${songs.length} entr${songs.length === 1 ? "y" : "ies"}`);
  } finally {
    await store.close();
    log(`Closed metadata database connection: ${store.location}`);
  }
  return { imported: songs.length, databasePath: store.location };
}

export async function exportMetadataDatabaseToJson(
  jsonFilePath: string,
  databasePathOrConfig?: string | MetadataStoreConfig,
  options: MetadataStoreOptions = {},
): Promise<{ exported: number; databasePath: string; jsonFilePath: string }> {
  const log = options.log ?? logMetadataDatabaseStatus;
  const resolvedJsonPath = path.resolve(jsonFilePath);
  log(`Exporting metadata database to JSON: ${resolvedJsonPath}`);
  const store = await createMetadataStore(databasePathOrConfig, options);
  try {
    log(`Reading metadata from database: ${store.location}`);
    const songs = await store.loadAll();
    log(`Writing ${songs.length} metadata entr${songs.length === 1 ? "y" : "ies"} to JSON`);
    writeMetadataJsonFile(resolvedJsonPath, songs);
    log(`Metadata JSON export complete: ${resolvedJsonPath}`);
    return {
      exported: songs.length,
      databasePath: store.location,
      jsonFilePath: resolvedJsonPath,
    };
  } finally {
    await store.close();
    log(`Closed metadata database connection: ${store.location}`);
  }
}

export class SqliteMetadataStore implements MetadataStore {
  readonly location: string;
  private log?: MetadataStoreLogger;
  private existedBeforeOpen: boolean;
  private db: Database.Database;
  private insertSongStatement: Database.Statement;
  private upsertTagStatement: Database.Statement;
  private selectTagIdStatement: Database.Statement;
  private insertSongTagStatement: Database.Statement;
  private insertSongNegativeTagStatement: Database.Statement;
  private insertMashupSourceStatement: Database.Statement;
  private upsertWorkspaceStatement: Database.Statement;
  private upsertSongWorkspaceStatement: Database.Statement;

  constructor(databasePath: string = DEFAULT_DATABASE_PATH, options: MetadataStoreOptions = {}) {
    this.location = path.resolve(databasePath);
    this.log = options.log ?? logMetadataDatabaseStatus;
    this.existedBeforeOpen = fs.existsSync(this.location);
    this.log?.(`Opening SQLite metadata database: ${this.location}`);
    this.log?.(`SQLite database file ${this.existedBeforeOpen ? "exists" : "will be created"}`);
    fs.mkdirSync(path.dirname(this.location), { recursive: true });

    this.db = new Database(this.location);
    this.log?.("SQLite connection opened");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(SQLITE_SCHEMA);
    this.log?.("SQLite schema ready");
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
    this.upsertTagStatement = this.db.prepare(
      "INSERT OR IGNORE INTO tags (name, normalized_name) VALUES (?, ?)",
    );
    this.selectTagIdStatement = this.db.prepare(
      "SELECT id FROM tags WHERE normalized_name = ?",
    );
    this.insertSongTagStatement = this.db.prepare(
      "INSERT OR IGNORE INTO song_tags (clip_id, tag_id) VALUES (?, ?)",
    );
    this.insertSongNegativeTagStatement = this.db.prepare(
      "INSERT OR IGNORE INTO song_negative_tags (clip_id, tag_id) VALUES (?, ?)",
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
  }

  async exists(): Promise<boolean> {
    return this.existedBeforeOpen;
  }

  async loadAll(): Promise<ISongData[]> {
    const startedAt = Date.now();
    this.log?.("SQLite loading songs from metadata database");
    const rows = this.db
      .prepare("SELECT * FROM songs ORDER BY sort_index ASC, clip_id ASC")
      .all() as any[];
    this.log?.(`SQLite retrieved ${rows.length} song row${rows.length === 1 ? "" : "s"} in ${Date.now() - startedAt}ms`);
    const songs = rows.map((row) => normalizeMetadata(this.rowToSong(row)));
    this.log?.(`SQLite hydrated ${songs.length} song${songs.length === 1 ? "" : "s"} from metadata database`);
    return songs;
  }

  async loadByClipIds(clipIds: string[]): Promise<ISongData[]> {
    const uniqueClipIds = Array.from(new Set(clipIds.map((clipId) => clipId.trim()).filter(Boolean)));
    if (uniqueClipIds.length === 0) {
      this.log?.("SQLite targeted metadata load skipped: no clip ids");
      return [];
    }

    const startedAt = Date.now();
    this.log?.(`SQLite loading targeted metadata: ${uniqueClipIds.length} clip id${uniqueClipIds.length === 1 ? "" : "s"}`);
    const placeholders = uniqueClipIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(`SELECT * FROM songs WHERE clip_id IN (${placeholders}) ORDER BY sort_index ASC, clip_id ASC`)
      .all(...uniqueClipIds) as any[];
    this.log?.(`SQLite retrieved ${rows.length}/${uniqueClipIds.length} targeted song row${rows.length === 1 ? "" : "s"} in ${Date.now() - startedAt}ms`);
    return rows.map((row) => normalizeMetadata(this.rowToSong(row)));
  }

  async loadDownloadVerifications(clipIds: string[]): Promise<DownloadVerification[]> {
    const uniqueClipIds = Array.from(new Set(clipIds.map((clipId) => clipId.trim()).filter(Boolean)));
    if (uniqueClipIds.length === 0) return [];

    const placeholders = uniqueClipIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(`
        SELECT clip_id, raw_api_response_json IS NOT NULL AS has_raw_api_response,
          mp3_status, wav_status
        FROM songs
        WHERE clip_id IN (${placeholders})
      `)
      .all(...uniqueClipIds) as Array<{
        clip_id: string;
        has_raw_api_response: number;
        mp3_status: string | null;
        wav_status: string | null;
      }>;
    return rows.map((row) => ({
      clipId: row.clip_id,
      hasRawApiResponse: row.has_raw_api_response === 1,
      mp3Status: row.mp3_status ?? undefined,
      wavStatus: row.wav_status ?? undefined,
    }));
  }

  async getByClipId(clipId: string): Promise<ISongData | undefined> {
    const normalizedClipId = clipId.trim();
    if (!normalizedClipId) return undefined;

    this.log?.(`SQLite retrieving metadata for clip: ${normalizedClipId}`);
    const row = this.db
      .prepare("SELECT * FROM songs WHERE clip_id = ?")
      .get(normalizedClipId) as any | undefined;
    if (!row) {
      this.log?.(`SQLite metadata not found for clip: ${normalizedClipId}`);
      return undefined;
    }
    this.log?.(`SQLite metadata found for clip: ${normalizedClipId}`);
    return normalizeMetadata(this.rowToSong(row));
  }

  async listWorkspaces(): Promise<IWorkspace[]> {
    const rows = this.db
      .prepare(`
        SELECT id, name, description, is_trashed, is_public
        FROM workspaces
        ORDER BY name COLLATE NOCASE ASC, id ASC
      `)
      .all() as Array<{
        id: string;
        name: string;
        description: string | null;
        is_trashed: number;
        is_public: number;
      }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      is_trashed: row.is_trashed === 1,
      is_public: row.is_public === 1,
    }));
  }

  async listPendingAssetClipIds(workspaceId: string, format: "mp3" | "wav", limit: number = Number.MAX_SAFE_INTEGER): Promise<string[]> {
    const column = format === "mp3" ? "mp3_status" : "wav_status";
    const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : Number.MAX_SAFE_INTEGER;
    const rows = this.db
      .prepare(`
        SELECT s.clip_id
        FROM songs s
        INNER JOIN song_workspaces sw ON sw.clip_id = s.clip_id
        WHERE sw.workspace_id = ?
          AND s.raw_api_response_json IS NOT NULL
          AND COALESCE(s.${column}, 'PENDING') <> 'DOWNLOADED'
        ORDER BY s.sort_index ASC, s.clip_id ASC
        LIMIT ?
      `)
      .all(workspaceId, normalizedLimit) as Array<{ clip_id: string }>;
    return rows.map((row) => row.clip_id);
  }

  async saveAll(songs: ISongData[]): Promise<void> {
    const normalizedSongs = songs.map((song) => normalizeMetadata(song));

    this.log?.(`SQLite saveAll starting: ${normalizedSongs.length} song${normalizedSongs.length === 1 ? "" : "s"}`);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const deleteResult = this.db.prepare("DELETE FROM songs").run();
      this.log?.(`SQLite cleared existing songs: ${deleteResult.changes} row${deleteResult.changes === 1 ? "" : "s"}`);
      normalizedSongs.forEach((song, index) => {
        this.writeSong(song, index);
      });
      this.db.exec("COMMIT");
      this.log?.(`SQLite transaction committed: ${normalizedSongs.length} song${normalizedSongs.length === 1 ? "" : "s"} saved`);
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.log?.("SQLite transaction rolled back");
      throw error;
    }
  }

  async upsert(song: ISongData): Promise<void> {
    const normalizedSong = normalizeMetadata(song);
    this.log?.(`SQLite upsert starting: ${normalizedSong.clipId}`);
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
      this.log?.(`SQLite upsert committed: ${normalizedSong.clipId}`);
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.log?.(`SQLite upsert rolled back: ${normalizedSong.clipId}`);
      throw error;
    }
  }

  async upsertWorkspaces(workspaces: IWorkspace[]): Promise<void> {
    this.log?.(`SQLite workspace upsert starting: ${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}`);
    const save = this.db.transaction((workspaceRows: IWorkspace[]) => {
      workspaceRows.forEach((workspace) => {
        this.writeWorkspace(workspace);
      });
    });
    save(workspaces);
    this.log?.(`SQLite workspace upsert complete: ${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}`);
  }

  async upsertSongWorkspace(
    clipId: string,
    workspace: IWorkspace,
    source: string = "discovery",
  ): Promise<void> {
    //this.log?.(`SQLite song-workspace link upsert starting: clip=${clipId}, workspace=${workspace.id}, source=${source}`);
    const save = this.db.transaction(() => {
      this.writeWorkspace(workspace);
      this.upsertSongWorkspaceStatement.run(clipId, workspace.id, source);
    });
    save();
    //this.log?.(`SQLite song-workspace link upsert complete: clip=${clipId}, workspace=${workspace.id}`);
  }

  close(): void {
    this.db.close();
    this.log?.("SQLite connection closed");
  }

  private writeSong(song: ISongData, sortIndex: number): void {
    this.insertSongStatement.run(this.songToRow(song, sortIndex));
    this.db.prepare("DELETE FROM song_tags WHERE clip_id = ?").run(song.clipId);
    this.db.prepare("DELETE FROM song_negative_tags WHERE clip_id = ?").run(song.clipId);
    this.db.prepare("DELETE FROM song_mashup_sources WHERE clip_id = ?").run(song.clipId);

    uniqueTagsByIdentity(song.tags || []).forEach((tag) => {
      this.writeTagLink(song.clipId, tag.name, this.insertSongTagStatement);
    });
    uniqueTagsByIdentity(song.negativeTags || []).forEach((tag) => {
      this.writeTagLink(song.clipId, tag.name, this.insertSongNegativeTagStatement);
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

  private writeTagLink(
    clipId: string,
    tag: string,
    insertLinkStatement: Database.Statement,
  ): void {
    const normalizedTag = tag.trim();
    if (!normalizedTag) return;
    const normalizedName = normalizeTagForIdentity(normalizedTag);
    if (!normalizedName) return;
    this.upsertTagStatement.run(normalizedTag, normalizedName);
    const tagRow = this.selectTagIdStatement.get(normalizedName) as { id: number } | undefined;
    if (!tagRow) return;
    insertLinkStatement.run(clipId, tagRow.id);
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
    const tags = this.getTagChildren("song_tags", row.clip_id);
    const negativeTags = this.getTagChildren("song_negative_tags", row.clip_id);
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

  private getTagChildren(joinTableName: string, clipId: string): string[] {
    const rows = this.db
      .prepare(`
        SELECT tags.name AS value
        FROM ${joinTableName}
        JOIN tags ON tags.id = ${joinTableName}.tag_id
        WHERE ${joinTableName}.clip_id = ?
        ORDER BY tags.name COLLATE NOCASE ASC
      `)
      .all(clipId) as Array<{ value: string }>;
    return rows.map((row) => row.value);
  }

  private getStringChildren(tableName: string, valueColumn: string, clipId: string): string[] {
    const rows = this.db
      .prepare(`SELECT ${valueColumn} AS value FROM ${tableName} WHERE clip_id = ? ORDER BY sort_index ASC`)
      .all(clipId) as Array<{ value: string }>;
    return rows.map((row) => row.value);
  }
}

export class PostgresMetadataStore implements MetadataStore {
  readonly location: string;
  private static readonly SONG_BATCH_SIZE = 500;
  private static readonly CHILD_BATCH_SIZE = 5000;
  private readonly connectionString: string;
  private log?: MetadataStoreLogger;
  private pool: Pool;
  private existedBeforeInitialize = false;
  private initialized = false;
  private closed = false;

  constructor(postgresUrl?: string, options: MetadataStoreOptions = {}) {
    const resolvedConnectionString = postgresUrl?.trim() || process.env.SUNO_EXPORT_POSTGRES_URL;
    if (!resolvedConnectionString) {
      throw new Error("Postgres metadata database selected; provide --postgres-url or SUNO_EXPORT_POSTGRES_URL");
    }
    this.connectionString = resolvedConnectionString;
    this.log = options.log ?? logMetadataDatabaseStatus;
    this.location = describePostgresConnection(this.connectionString);
    this.log?.(`Creating Postgres metadata pool: ${this.location}`);
    this.pool = this.createPool();
  }

  async initialize(): Promise<void> {
    if (this.closed) {
      this.pool = this.createPool();
      this.closed = false;
      this.initialized = false;
      this.log?.(`Recreated Postgres metadata pool: ${this.location}`);
    }
    if (this.initialized) return;
    this.log?.(`Opening Postgres connection: ${this.location}`);
    const connectedAt = Date.now();
    const client = await this.pool.connect();
    try {
      this.log?.(`Postgres connection ready in ${Date.now() - connectedAt}ms`);
      await withPostgresAdvisoryLock(
        client,
        METADATA_SCHEMA_LOCK_NAMESPACE,
        METADATA_SCHEMA_LOCK_RESOURCE,
        async () => {
          const existing = await client.query("SELECT to_regclass('public.songs') AS table_name");
          this.existedBeforeInitialize = existing.rows[0]?.table_name === "songs";
          this.log?.(`Postgres songs table ${this.existedBeforeInitialize ? "exists" : "will be created"}`);
          await client.query(POSTGRES_SCHEMA);
        },
      );
    } finally {
      client.release();
    }
    this.initialized = true;
  }

  async exists(): Promise<boolean> {
    return this.existedBeforeInitialize;
  }

  async loadAll(): Promise<ISongData[]> {
    await this.initialize();
    const startedAt = Date.now();
    this.log?.("Postgres loading songs from metadata database");
    const result = await this.pool.query("SELECT * FROM songs ORDER BY sort_index ASC, clip_id ASC");
    this.log?.(`Postgres retrieved ${result.rows.length} song row${result.rows.length === 1 ? "" : "s"} in ${Date.now() - startedAt}ms`);
    const songs: ISongData[] = [];
    for (let index = 0; index < result.rows.length; index++) {
      const row = result.rows[index];
      songs.push(normalizeMetadata(await this.rowToSong(row)));
    }
    this.log?.(`Postgres metadata load complete in ${Date.now() - startedAt}ms`);
    return songs;
  }

  async loadByClipIds(clipIds: string[]): Promise<ISongData[]> {
    await this.initialize();
    const uniqueClipIds = Array.from(new Set(clipIds.map((clipId) => clipId.trim()).filter(Boolean)));
    if (uniqueClipIds.length === 0) {
      this.log?.("Postgres targeted metadata load skipped: no clip ids");
      return [];
    }

    const startedAt = Date.now();
    // this.log?.(`Postgres loading targeted metadata: ${uniqueClipIds.length} clip id${uniqueClipIds.length === 1 ? "" : "s"}`);
    const result = await this.pool.query(
      "SELECT * FROM songs WHERE clip_id = ANY($1::text[]) ORDER BY sort_index ASC, clip_id ASC",
      [uniqueClipIds],
    );
    //this.log?.(`Postgres retrieved ${result.rows.length}/${uniqueClipIds.length} targeted song row${result.rows.length === 1 ? "" : "s"} in ${Date.now() - startedAt}ms`);

    const songs: ISongData[] = [];
    for (let index = 0; index < result.rows.length; index++) {
      songs.push(normalizeMetadata(await this.rowToSong(result.rows[index])));
    }
    //this.log?.(`Postgres targeted metadata load complete in ${Date.now() - startedAt}ms`);
    return songs;
  }

  async loadDownloadVerifications(clipIds: string[]): Promise<DownloadVerification[]> {
    await this.initialize();
    const uniqueClipIds = Array.from(new Set(clipIds.map((clipId) => clipId.trim()).filter(Boolean)));
    if (uniqueClipIds.length === 0) return [];

    const result = await this.pool.query(
      `
      SELECT clip_id, raw_api_response_json IS NOT NULL AS has_raw_api_response,
        mp3_status, wav_status
      FROM songs
      WHERE clip_id = ANY($1::text[])
      `,
      [uniqueClipIds],
    );
    return result.rows.map((row) => ({
      clipId: row.clip_id as string,
      hasRawApiResponse: row.has_raw_api_response === true,
      mp3Status: (row.mp3_status as string | null) ?? undefined,
      wavStatus: (row.wav_status as string | null) ?? undefined,
    }));
  }

  async getByClipId(clipId: string): Promise<ISongData | undefined> {
    await this.initialize();
    const normalizedClipId = clipId.trim();
    if (!normalizedClipId) return undefined;

    const startedAt = Date.now();
    this.log?.(`Postgres retrieving metadata for clip: ${normalizedClipId}`);
    const result = await this.pool.query("SELECT * FROM songs WHERE clip_id = $1", [normalizedClipId]);
    if (result.rows.length === 0) {
      this.log?.(`Postgres metadata not found for clip: ${normalizedClipId} (${Date.now() - startedAt}ms)`);
      return undefined;
    }
    //this.log?.(`Postgres metadata found for clip: ${normalizedClipId} (${Date.now() - startedAt}ms)`);
    return normalizeMetadata(await this.rowToSong(result.rows[0]));
  }

  async listWorkspaces(): Promise<IWorkspace[]> {
    await this.initialize();
    const result = await this.pool.query(`
      SELECT id, name, description, is_trashed, is_public
      FROM workspaces
      ORDER BY name ASC, id ASC
    `);
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      is_trashed: row.is_trashed === true,
      is_public: row.is_public === true,
    }));
  }

  async listPendingAssetClipIds(workspaceId: string, format: "mp3" | "wav", limit: number = Number.MAX_SAFE_INTEGER): Promise<string[]> {
    await this.initialize();
    const column = format === "mp3" ? "mp3_status" : "wav_status";
    const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : Number.MAX_SAFE_INTEGER;
    const result = await this.pool.query(
      `
      SELECT s.clip_id
      FROM songs s
      INNER JOIN song_workspaces sw ON sw.clip_id = s.clip_id
      WHERE sw.workspace_id = $1
        AND s.raw_api_response_json IS NOT NULL
        AND COALESCE(s.${column}, 'PENDING') <> 'DOWNLOADED'
      ORDER BY s.sort_index ASC, s.clip_id ASC
      LIMIT $2
      `,
      [workspaceId, normalizedLimit],
    );
    return result.rows.map((row) => row.clip_id as string);
  }

  async saveAll(songs: ISongData[]): Promise<void> {
    await this.initialize();
    const normalizedSongs = songs.map((song) => normalizeMetadata(song));
    const effectiveSongs = this.dedupeSongsForFullReplace(normalizedSongs);
    const client = await this.pool.connect();
    try {
      this.log?.(`Postgres saveAll starting: ${normalizedSongs.length} song${normalizedSongs.length === 1 ? "" : "s"}`);
      if (effectiveSongs.length !== normalizedSongs.length) {
        this.log?.(`Postgres deduplicated songs by clip_id: ${normalizedSongs.length} input rows -> ${effectiveSongs.length} database rows`);
      }
      await client.query("BEGIN");
      const deleteResult = await client.query("DELETE FROM songs");
      this.log?.(`Postgres cleared existing songs: ${deleteResult.rowCount ?? 0} row${deleteResult.rowCount === 1 ? "" : "s"}`);
      await this.writeSongsBatch(client, effectiveSongs);
      await this.writeSongChildrenBatch(client, effectiveSongs);
      await this.writeSongProjectsBatch(client, effectiveSongs);
      await client.query("COMMIT");
     //this.log?.(`Postgres transaction committed: ${effectiveSongs.length} song${effectiveSongs.length === 1 ? "" : "s"} saved`);
    } catch (error) {
      await client.query("ROLLBACK");
      this.log?.("Postgres transaction rolled back");
      throw error;
    } finally {
      client.release();
    //  this.log?.("Postgres client released");
    }
  }

  private dedupeSongsForFullReplace(songs: ISongData[]): ISongData[] {
    const byClipId = new Map<string, { song: ISongData; sortIndex: number }>();
    songs.forEach((song, sortIndex) => {
      byClipId.set(song.clipId, { song, sortIndex });
    });
    return Array.from(byClipId.values())
      .sort((a, b) => a.sortIndex - b.sortIndex)
      .map((entry) => entry.song);
  }

  private async writeSongsBatch(client: PoolClient, songs: ISongData[]): Promise<void> {
    const columns = [
      "clip_id",
      "sort_index",
      "title",
      "song_url",
      "style",
      "thumbnail",
      "model",
      "duration",
      "liked",
      "artist_name",
      "lyrics",
      "creation_date",
      "weirdness",
      "style_strength",
      "audio_strength",
      "remix_parent",
      "comment",
      "upload",
      "is_hidden",
      "gpt_description_prompt",
      "persona_id",
      "persona_name",
      "project_name",
      "explicit",
      "flagged_reason",
      "mp3_status",
      "wav_status",
      "alac_status",
      "flac_status",
      "image_status",
      "mp3_timestamp",
      "wav_timestamp",
      "alac_timestamp",
      "flac_timestamp",
      "raw_api_response_json",
    ];
    const updateColumns = columns.filter((column) => column !== "clip_id");
    let totalRows = 0;

    for (let offset = 0; offset < songs.length; offset += PostgresMetadataStore.SONG_BATCH_SIZE) {
      const chunk = songs.slice(offset, offset + PostgresMetadataStore.SONG_BATCH_SIZE);
      const rows = chunk.map((song, chunkIndex) => {
        const row = this.songToRow(song, offset + chunkIndex);
        return [
          row.clipId,
          row.sortIndex,
          row.title,
          row.songUrl,
          row.style,
          row.thumbnail,
          row.model,
          row.duration,
          row.liked,
          row.artistName,
          row.lyrics,
          row.creationDate,
          row.weirdness,
          row.styleStrength,
          row.audioStrength,
          row.remixParent,
          row.comment,
          row.upload,
          row.isHidden,
          row.gptDescriptionPrompt,
          row.personaId,
          row.personaName,
          row.projectName,
          row.explicit,
          row.flaggedReason,
          row.mp3Status,
          row.wavStatus,
          row.alacStatus,
          row.flacStatus,
          row.imageStatus,
          row.mp3Timestamp,
          row.wavTimestamp,
          row.alacTimestamp,
          row.flacTimestamp,
          row.rawApiResponseJson,
        ];
      });
      await this.insertRows(
        client,
        "songs",
        columns,
        rows,
        `ON CONFLICT (clip_id) DO UPDATE SET ${updateColumns
          .map((column) => `${column} = EXCLUDED.${column}`)
          .join(", ")}, updated_at = CURRENT_TIMESTAMP`,
      );
      totalRows += rows.length;
      this.log?.(`Postgres saved song batch: ${totalRows}/${songs.length}`);
    }
  }

  private async writeSongChildrenBatch(client: PoolClient, songs: ISongData[]): Promise<void> {
    const tags = new Map<string, string>();
    const tagLinkRows: unknown[][] = [];
    const negativeTagLinkRows: unknown[][] = [];
    const mashupSourceRows: unknown[][] = [];

    songs.forEach((song) => {
      (song.tags || []).forEach((tag) => {
        const normalizedTag = tag.trim();
        const key = normalizeTagForIdentity(normalizedTag);
        if (!key) return;
        tags.set(key, tags.has(key) ? preferTagDisplayName(tags.get(key)!, normalizedTag) : normalizedTag);
        tagLinkRows.push([song.clipId, key]);
      });
      (song.negativeTags || []).forEach((tag) => {
        const normalizedTag = tag.trim();
        const key = normalizeTagForIdentity(normalizedTag);
        if (!key) return;
        tags.set(key, tags.has(key) ? preferTagDisplayName(tags.get(key)!, normalizedTag) : normalizedTag);
        negativeTagLinkRows.push([song.clipId, key]);
      });
      (song.mashupSource || []).forEach((source, index) => {
        mashupSourceRows.push([song.clipId, index, source]);
      });
    });

    await this.insertRowsInChunks(
      client,
      "tags",
      ["name", "normalized_name"],
      Array.from(tags.entries()).map(([normalizedName, name]) => [name, normalizedName]),
      "ON CONFLICT DO NOTHING",
    );
    await this.insertTagLinksInChunks(client, "song_tags", tagLinkRows);
    await this.insertTagLinksInChunks(client, "song_negative_tags", negativeTagLinkRows);
    await this.insertRowsInChunks(
      client,
      "song_mashup_sources",
      ["clip_id", "sort_index", "source"],
      mashupSourceRows,
    );
    this.log?.(`Postgres saved child metadata rows: uniqueTags=${tags.size}, tagLinks=${tagLinkRows.length}, negativeTagLinks=${negativeTagLinkRows.length}, mashupSources=${mashupSourceRows.length}`);
  }

  private async insertTagLinksInChunks(
    client: PoolClient,
    joinTableName: string,
    rows: unknown[][],
  ): Promise<void> {
    for (let offset = 0; offset < rows.length; offset += PostgresMetadataStore.CHILD_BATCH_SIZE) {
      await this.insertTagLinks(
        client,
        joinTableName,
        rows.slice(offset, offset + PostgresMetadataStore.CHILD_BATCH_SIZE),
      );
    }
  }

  private async insertTagLinks(
    client: PoolClient,
    joinTableName: string,
    rows: unknown[][],
  ): Promise<void> {
    if (rows.length === 0) return;

    const values: unknown[] = [];
    const placeholders = rows.map((row) => {
      const rowPlaceholders = row.map((value) => {
        values.push(value);
        return `$${values.length}`;
      });
      return `(${rowPlaceholders.join(", ")})`;
    });

    await client.query(
      `
      INSERT INTO ${joinTableName} (clip_id, tag_id)
      SELECT input.clip_id, tags.id
      FROM (VALUES ${placeholders.join(", ")}) AS input(clip_id, normalized_name)
      JOIN tags ON tags.normalized_name = input.normalized_name
      ON CONFLICT DO NOTHING
      `,
      values,
    );
  }

  private async writeSongProjectsBatch(client: PoolClient, songs: ISongData[]): Promise<void> {
    const workspaces = new Map<string, ITrackProject>();
    const songWorkspaceRows = new Map<string, unknown[]>();

    songs.forEach((song) => {
      const project = song.rawApiResponse?.project;
      if (!project) return;
      workspaces.set(project.id, project);
      songWorkspaceRows.set(`${song.clipId}\0${project.id}`, [song.clipId, project.id, "metadata"]);
    });

    const workspaceRows = Array.from(workspaces.values()).map((workspace) => [
      workspace.id,
      workspace.name,
      workspace.description ?? null,
      workspace.is_trashed === true,
      workspace.is_public === true,
    ]);
    await this.insertRowsInChunks(
      client,
      "workspaces",
      ["id", "name", "description", "is_trashed", "is_public"],
      workspaceRows,
      `ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        is_trashed = EXCLUDED.is_trashed,
        is_public = EXCLUDED.is_public,
        updated_at = CURRENT_TIMESTAMP,
        last_seen_at = CURRENT_TIMESTAMP`,
    );

    await this.insertRowsInChunks(
      client,
      "song_workspaces",
      ["clip_id", "workspace_id", "source"],
      Array.from(songWorkspaceRows.values()),
      `ON CONFLICT (clip_id, workspace_id) DO UPDATE SET
        source = EXCLUDED.source,
        updated_at = CURRENT_TIMESTAMP`,
    );
    this.log?.(`Postgres saved project metadata rows: workspaces=${workspaceRows.length}, songWorkspaces=${songWorkspaceRows.size}`);
  }

  private async insertRowsInChunks(
    client: PoolClient,
    tableName: string,
    columns: string[],
    rows: unknown[][],
    conflictClause?: string,
  ): Promise<void> {
    for (let offset = 0; offset < rows.length; offset += PostgresMetadataStore.CHILD_BATCH_SIZE) {
      await this.insertRows(
        client,
        tableName,
        columns,
        rows.slice(offset, offset + PostgresMetadataStore.CHILD_BATCH_SIZE),
        conflictClause,
      );
    }
  }

  private async insertRows(
    client: PoolClient,
    tableName: string,
    columns: string[],
    rows: unknown[][],
    conflictClause?: string,
  ): Promise<void> {
    if (rows.length === 0) return;

    const values: unknown[] = [];
    const placeholders = rows.map((row) => {
      const rowPlaceholders = row.map((value) => {
        values.push(value);
        return `$${values.length}`;
      });
      return `(${rowPlaceholders.join(", ")})`;
    });

    await client.query(
      `
      INSERT INTO ${tableName} (${columns.join(", ")})
      VALUES ${placeholders.join(", ")}
      ${conflictClause ?? ""}
      `,
      values,
    );
  }

  async upsert(song: ISongData): Promise<void> {
    await this.initialize();
    const normalizedSong = normalizeMetadata(song);
    this.log?.(`Updating metadata for clip: ${normalizedSong.clipId}`);
    const client = await this.pool.connect();
    //this.log?.(`Postgres client acquired for song upsert: ${normalizedSong.clipId}`);
    try {
      await client.query("BEGIN");
      const currentMax = await client.query("SELECT COALESCE(MAX(sort_index), -1) AS max_index FROM songs");
      const existing = await client.query("SELECT sort_index FROM songs WHERE clip_id = $1", [normalizedSong.clipId]);
      const sortIndex = existing.rows[0]?.sort_index ?? Number(currentMax.rows[0]?.max_index ?? -1) + 1;

      await this.writeSong(client, normalizedSong, sortIndex);
      await client.query("COMMIT");
      //this.log?.(`Postgres upsert committed: ${normalizedSong.clipId}`);
    } catch (error) {
      await client.query("ROLLBACK");
      this.log?.(`Postgres upsert rolled back for metadata update: ${normalizedSong.clipId}`);
      throw error;
    } finally {
      client.release();
      //this.log?.(`Postgres client released after song upsert: ${normalizedSong.clipId}`);
    }
  }

  async upsertWorkspaces(workspaces: IWorkspace[]): Promise<void> {
    await this.initialize();
    this.log?.(`Updating workspaces: ${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}`);
    const client = await this.pool.connect();
    //this.log?.("Postgres client acquired for workspace upsert");
    try {
      await client.query("BEGIN");
      for (const workspace of workspaces) {
        await this.writeWorkspace(client, workspace);
      }
      await client.query("COMMIT");
      //this.log?.(`Postgres workspace upsert committed: ${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}`);
    } catch (error) {
      await client.query("ROLLBACK");
      this.log?.("Postgres workspace upsert rolled back for workspace update");
      throw error;
    } finally {
      client.release();
      //this.log?.("Postgres client released after workspace upsert");
    }
  }

  async upsertSongWorkspace(
    clipId: string,
    workspace: IWorkspace,
    source: string = "discovery",
  ): Promise<void> {
    await this.initialize();
    this.log?.(`Syncing clip to workspace: clip=${clipId}, workspace=${workspace.id}, source=${source}`);

    //this.log?.(`Postgres song-workspace link upsert starting: clip=${clipId}, workspace=${workspace.id}, source=${source}`);
    const client = await this.pool.connect();
    //this.log?.(`Postgres client acquired for song-workspace link: clip=${clipId}, workspace=${workspace.id}`);
    try {
      await client.query("BEGIN");
      await this.writeWorkspace(client, workspace);
      await client.query(
        `
        INSERT INTO song_workspaces (clip_id, workspace_id, source, updated_at)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        ON CONFLICT (clip_id, workspace_id) DO UPDATE SET
          source = EXCLUDED.source,
          updated_at = CURRENT_TIMESTAMP
        `,
        [clipId, workspace.id, source],
      );
      await client.query("COMMIT");
      //this.log?.(`Postgres song-workspace link upsert committed: clip=${clipId}, workspace=${workspace.id}`);
    } catch (error) {
      await client.query("ROLLBACK");
      this.log?.(`Postgres song-workspace link upsert rolled back: clip=${clipId}, workspace=${workspace.id}`);
      throw error;
    } finally {
      client.release();
      //this.log?.(`Postgres client released after song-workspace link: clip=${clipId}, workspace=${workspace.id}`);
    }
  }

  close(): Promise<void> {
    if (this.closed) {
      return Promise.resolve();
    }
    this.closed = true;
    this.initialized = false;
    return this.pool.end();
  }

  private createPool(): Pool {
    return new Pool({ connectionString: this.connectionString });
  }

  private async writeSong(client: PoolClient, song: ISongData, sortIndex: number): Promise<void> {
    const row = this.songToRow(song, sortIndex);
    await client.query(
      `
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
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24,
        $25, $26, $27, $28, $29,
        $30, $31, $32, $33,
        $34, $35, CURRENT_TIMESTAMP
      )
      ON CONFLICT (clip_id) DO UPDATE SET
        sort_index = EXCLUDED.sort_index,
        title = EXCLUDED.title,
        song_url = EXCLUDED.song_url,
        style = EXCLUDED.style,
        thumbnail = EXCLUDED.thumbnail,
        model = EXCLUDED.model,
        duration = EXCLUDED.duration,
        liked = EXCLUDED.liked,
        artist_name = EXCLUDED.artist_name,
        lyrics = EXCLUDED.lyrics,
        creation_date = EXCLUDED.creation_date,
        weirdness = EXCLUDED.weirdness,
        style_strength = EXCLUDED.style_strength,
        audio_strength = EXCLUDED.audio_strength,
        remix_parent = EXCLUDED.remix_parent,
        comment = EXCLUDED.comment,
        upload = EXCLUDED.upload,
        is_hidden = EXCLUDED.is_hidden,
        gpt_description_prompt = EXCLUDED.gpt_description_prompt,
        persona_id = EXCLUDED.persona_id,
        persona_name = EXCLUDED.persona_name,
        project_name = EXCLUDED.project_name,
        explicit = EXCLUDED.explicit,
        flagged_reason = EXCLUDED.flagged_reason,
        mp3_status = EXCLUDED.mp3_status,
        wav_status = EXCLUDED.wav_status,
        alac_status = EXCLUDED.alac_status,
        flac_status = EXCLUDED.flac_status,
        image_status = EXCLUDED.image_status,
        mp3_timestamp = EXCLUDED.mp3_timestamp,
        wav_timestamp = EXCLUDED.wav_timestamp,
        alac_timestamp = EXCLUDED.alac_timestamp,
        flac_timestamp = EXCLUDED.flac_timestamp,
        raw_api_response_json = EXCLUDED.raw_api_response_json,
        updated_at = CURRENT_TIMESTAMP
      `,
      [
        row.clipId,
        row.sortIndex,
        row.title,
        row.songUrl,
        row.style,
        row.thumbnail,
        row.model,
        row.duration,
        row.liked,
        row.artistName,
        row.lyrics,
        row.creationDate,
        row.weirdness,
        row.styleStrength,
        row.audioStrength,
        row.remixParent,
        row.comment,
        row.upload,
        row.isHidden,
        row.gptDescriptionPrompt,
        row.personaId,
        row.personaName,
        row.projectName,
        row.explicit,
        row.flaggedReason,
        row.mp3Status,
        row.wavStatus,
        row.alacStatus,
        row.flacStatus,
        row.imageStatus,
        row.mp3Timestamp,
        row.wavTimestamp,
        row.alacTimestamp,
        row.flacTimestamp,
        row.rawApiResponseJson,
      ],
    );

    await client.query("DELETE FROM song_tags WHERE clip_id = $1", [song.clipId]);
    await client.query("DELETE FROM song_negative_tags WHERE clip_id = $1", [song.clipId]);
    await client.query("DELETE FROM song_mashup_sources WHERE clip_id = $1", [song.clipId]);

    await this.writeTagLinks(client, "song_tags", song.clipId, song.tags || []);
    await this.writeTagLinks(client, "song_negative_tags", song.clipId, song.negativeTags || []);
    for (let index = 0; index < (song.mashupSource || []).length; index++) {
      await client.query(
        "INSERT INTO song_mashup_sources (clip_id, sort_index, source) VALUES ($1, $2, $3)",
        [song.clipId, index, song.mashupSource![index]],
      );
    }

    const project = song.rawApiResponse?.project;
    if (project) {
      await this.writeWorkspace(client, project);
      await client.query(
        `
        INSERT INTO song_workspaces (clip_id, workspace_id, source, updated_at)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        ON CONFLICT (clip_id, workspace_id) DO UPDATE SET
          source = EXCLUDED.source,
          updated_at = CURRENT_TIMESTAMP
        `,
        [song.clipId, project.id, "metadata"],
      );
    }
  }

  private async writeTagLinks(
    client: PoolClient,
    joinTableName: string,
    clipId: string,
    tags: string[],
  ): Promise<void> {
    const uniqueTags = uniqueTagsByIdentity(tags);
    if (uniqueTags.length === 0) return;

    await this.insertRowsInChunks(
      client,
      "tags",
      ["name", "normalized_name"],
      uniqueTags.map((tag) => [tag.name, tag.normalizedName]),
      "ON CONFLICT DO NOTHING",
    );
    await this.insertTagLinks(
      client,
      joinTableName,
      uniqueTags.map((tag) => [clipId, tag.normalizedName]),
    );
  }

  private async writeWorkspace(client: PoolClient, workspace: ITrackProject): Promise<void> {
    await client.query(
      `
      INSERT INTO workspaces (
        id, name, description, is_trashed, is_public, updated_at, last_seen_at
      )
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        is_trashed = EXCLUDED.is_trashed,
        is_public = EXCLUDED.is_public,
        updated_at = CURRENT_TIMESTAMP,
        last_seen_at = CURRENT_TIMESTAMP
      `,
      [
        workspace.id,
        workspace.name,
        workspace.description ?? null,
        workspace.is_trashed === true,
        workspace.is_public === true,
      ],
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
      liked: song.liked === true,
      artistName: song.artistName ?? null,
      lyrics: song.lyrics ?? null,
      creationDate: dateToDb(song.creationDate),
      weirdness: song.weirdness ?? null,
      styleStrength: song.styleStrength ?? null,
      audioStrength: song.audioStrength ?? null,
      remixParent: song.remixParent ?? null,
      comment: song.comment ?? null,
      upload: song.upload ?? null,
      isHidden: song.isHidden ?? null,
      gptDescriptionPrompt: song.gptDescriptionPrompt ?? null,
      personaId: song.personaId ?? null,
      personaName: song.personaName ?? null,
      projectName: song.projectName ?? null,
      explicit: song.explicit ?? null,
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

  private async rowToSong(row: any): Promise<ISongData> {
    const tags = await this.getTagChildren("song_tags", row.clip_id);
    const negativeTags = await this.getTagChildren("song_negative_tags", row.clip_id);
    const mashupSource = await this.getStringChildren("song_mashup_sources", "source", row.clip_id);

    return {
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
  }

  private async getTagChildren(joinTableName: string, clipId: string): Promise<string[]> {
    const result = await this.pool.query(
      `
      SELECT tags.name AS value
      FROM ${joinTableName}
      JOIN tags ON tags.id = ${joinTableName}.tag_id
      WHERE ${joinTableName}.clip_id = $1
      ORDER BY lower(tags.name) ASC
      `,
      [clipId],
    );
    return result.rows.map((row) => row.value);
  }

  private async getStringChildren(tableName: string, valueColumn: string, clipId: string): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT ${valueColumn} AS value FROM ${tableName} WHERE clip_id = $1 ORDER BY sort_index ASC`,
      [clipId],
    );
    return result.rows.map((row) => row.value);
  }
}
