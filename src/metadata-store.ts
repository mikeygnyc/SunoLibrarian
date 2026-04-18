import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { DEFAULT_DATABASE_PATH } from "./cli-defaults";
import type { ISongData } from "./lib/interfaces";
import { normalizeMetadata } from "./lib/metadata/normalize-metadata";

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS metadata_entries (
  clip_id TEXT PRIMARY KEY,
  sort_index INTEGER NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_metadata_entries_sort_index
ON metadata_entries(sort_index);
`;

export interface MetadataStore {
  readonly location: string;
  loadAll(): Promise<ISongData[]>;
  saveAll(songs: ISongData[]): Promise<void>;
  upsert(song: ISongData): Promise<void>;
  exists(): Promise<boolean>;
  close(): void;
}

function dateReviver(_key: string, value: any): any {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(value)) {
    return new Date(value);
  }
  return value;
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

  constructor(databasePath: string = DEFAULT_DATABASE_PATH) {
    this.location = path.resolve(databasePath);
    fs.mkdirSync(path.dirname(this.location), { recursive: true });

    this.db = new Database(this.location);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(SQLITE_SCHEMA);
  }

  async exists(): Promise<boolean> {
    return fs.existsSync(this.location);
  }

  async loadAll(): Promise<ISongData[]> {
    const rows = this.db
      .prepare("SELECT metadata_json FROM metadata_entries ORDER BY sort_index ASC, clip_id ASC")
      .all() as Array<{ metadata_json: string }>;
    return rows.map((row: { metadata_json: string }) =>
      normalizeMetadata(JSON.parse(row.metadata_json, dateReviver)),
    );
  }

  async saveAll(songs: ISongData[]): Promise<void> {
    const normalizedSongs = songs.map((song) => normalizeMetadata(song));
    const insert = this.db.prepare(`
      INSERT INTO metadata_entries (clip_id, sort_index, metadata_json, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(clip_id) DO UPDATE SET
        sort_index = excluded.sort_index,
        metadata_json = excluded.metadata_json,
        updated_at = CURRENT_TIMESTAMP
    `);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM metadata_entries").run();
      normalizedSongs.forEach((song, index) => {
        insert.run(song.clipId, index, JSON.stringify(song));
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
      .prepare("SELECT COALESCE(MAX(sort_index), -1) AS max_index FROM metadata_entries")
      .get() as { max_index: number };
    const existing = this.db
      .prepare("SELECT sort_index FROM metadata_entries WHERE clip_id = ?")
      .get(normalizedSong.clipId) as { sort_index: number } | undefined;
    const sortIndex = existing?.sort_index ?? currentMax.max_index + 1;

    this.db.prepare(`
      INSERT INTO metadata_entries (clip_id, sort_index, metadata_json, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(clip_id) DO UPDATE SET
        metadata_json = excluded.metadata_json,
        updated_at = CURRENT_TIMESTAMP
    `).run(normalizedSong.clipId, sortIndex, JSON.stringify(normalizedSong));
  }

  close(): void {
    this.db.close();
  }
}
