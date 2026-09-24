import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { SqliteMetadataStore } from "../src/metadata-store";
import type { ISongData } from "../src/lib/interfaces";

function createTempDatabasePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "suno-export-store-"));
  return path.join(dir, "metadata.sqlite");
}

test("stores song metadata in normalized tables", async () => {
  const databasePath = createTempDatabasePath();
  const store = new SqliteMetadataStore(databasePath);
  const song: ISongData = {
    clipId: "clip-1",
    title: "A Real Table",
    songUrl: "https://suno.com/song/clip-1",
    liked: true,
    rawApiResponse: {
      id: "clip-1",
      display_tags: "Synth, synth, pop",
      project: {
        id: "workspace-1",
        name: "From Metadata",
        description: "Project node",
        is_trashed: false,
        is_public: true,
      },
      metadata: {
        negative_tags: "muddy, Muddy, SYNTH",
        mashup_clip_ids: ["clip-0"],
      },
    } as any,
    wavStatus: "DOWNLOADED",
    wavTimestamp: new Date("2026-01-01T00:00:00.000Z"),
  };

  await store.saveAll([song]);
  store.close();

  const db = new Database(databasePath);
  try {
    const songRow = db.prepare("SELECT clip_id, title, liked FROM songs").get() as any;
    const songColumns = db.prepare("PRAGMA table_info(songs)").all() as Array<{ name: string }>;
    const tags = db.prepare("SELECT name FROM tags ORDER BY lower(name)").all() as Array<{ name: string }>;
    const positiveTagLinks = db
      .prepare(`
        SELECT songs.clip_id, tags.name
        FROM song_tags
        JOIN songs ON songs.clip_id = song_tags.clip_id
        JOIN tags ON tags.id = song_tags.tag_id
        ORDER BY lower(tags.name)
      `)
      .all() as Array<{ clip_id: string; name: string }>;
    const negativeTagLinks = db
      .prepare(`
        SELECT songs.clip_id, tags.name
        FROM song_negative_tags
        JOIN songs ON songs.clip_id = song_negative_tags.clip_id
        JOIN tags ON tags.id = song_negative_tags.tag_id
        ORDER BY lower(tags.name)
      `)
      .all() as Array<{ clip_id: string; name: string }>;
    const mashupSources = db.prepare("SELECT source FROM song_mashup_sources").all() as Array<{ source: string }>;
    const workspace = db.prepare("SELECT id, name, is_public FROM workspaces").get() as any;
    const songWorkspace = db.prepare("SELECT clip_id, workspace_id, source FROM song_workspaces").get() as any;

    assert.equal(songRow.clip_id, "clip-1");
    assert.equal(songRow.title, "A Real Table");
    assert.equal(songRow.liked, 1);
    assert.equal(songColumns.some((column) => column.name === "metadata_json"), false);
    assert.deepEqual(tags.map((row) => row.name), ["muddy", "pop", "Synth"]);
    assert.deepEqual(positiveTagLinks, [
      { clip_id: "clip-1", name: "pop" },
      { clip_id: "clip-1", name: "Synth" },
    ]);
    assert.deepEqual(negativeTagLinks, [
      { clip_id: "clip-1", name: "muddy" },
      { clip_id: "clip-1", name: "Synth" },
    ]);
    assert.deepEqual(mashupSources.map((row) => row.source), ["clip-0"]);
    assert.deepEqual(workspace, { id: "workspace-1", name: "From Metadata", is_public: 1 });
    assert.deepEqual(songWorkspace, {
      clip_id: "clip-1",
      workspace_id: "workspace-1",
      source: "metadata",
    });
  } finally {
    db.close();
  }
});

test("treats spaces and hyphens as equivalent for tag uniqueness", async () => {
  const databasePath = createTempDatabasePath();
  const store = new SqliteMetadataStore(databasePath);
  const song: ISongData = {
    clipId: "clip-brit",
    title: "Brit Tag Song",
    songUrl: "https://suno.com/song/clip-brit",
    liked: false,
    rawApiResponse: {
      id: "clip-brit",
      display_tags: "Brit pop, Brit-pop, Britpop, Dream-pop, Dream pop",
      metadata: {
        negative_tags: "Post punk, post-punk, postpunk",
      },
    } as any,
  };

  await store.saveAll([song]);
  const loaded = await store.getByClipId("clip-brit");
  store.close();

  const db = new Database(databasePath);
  try {
    const tags = db
      .prepare("SELECT name, normalized_name FROM tags ORDER BY normalized_name")
      .all() as Array<{ name: string; normalized_name: string }>;

    assert.deepEqual(tags, [
      { name: "Britpop", normalized_name: "britpop" },
      { name: "Dream-pop", normalized_name: "dreampop" },
      { name: "postpunk", normalized_name: "postpunk" },
    ]);
    assert.deepEqual(loaded?.tags, ["Britpop", "Dream-pop"]);
    assert.deepEqual(loaded?.negativeTags, ["postpunk"]);
  } finally {
    db.close();
  }
});

test("can store discovered track workspace links before song metadata exists", async () => {
  const databasePath = createTempDatabasePath();
  const store = new SqliteMetadataStore(databasePath);

  await store.upsertSongWorkspace(
    "clip-without-song-row",
    {
      id: "workspace-early",
      name: "Early",
      description: "Discovered from list",
      is_trashed: false,
      is_public: false,
    },
    "discovery",
  );
  store.close();

  const db = new Database(databasePath);
  try {
    const row = db.prepare("SELECT clip_id, workspace_id, source FROM song_workspaces").get();
    assert.deepEqual(row, {
      clip_id: "clip-without-song-row",
      workspace_id: "workspace-early",
      source: "discovery",
    });
  } finally {
    db.close();
  }
});

test("can load targeted metadata without hydrating every song", async () => {
  const databasePath = createTempDatabasePath();
  const store = new SqliteMetadataStore(databasePath);

  await store.saveAll([
    {
      clipId: "clip-1",
      title: "First",
      songUrl: "https://suno.com/song/clip-1",
      liked: false,
      rawApiResponse: { id: "clip-1", display_tags: "alpha" } as any,
    },
    {
      clipId: "clip-2",
      title: "Second",
      songUrl: "https://suno.com/song/clip-2",
      liked: true,
      rawApiResponse: { id: "clip-2", display_tags: "beta" } as any,
    },
  ]);

  const found = await store.getByClipId("clip-2");
  const missing = await store.getByClipId("missing");
  const targeted = await store.loadByClipIds(["clip-2"]);
  store.close();

  assert.equal(found?.clipId, "clip-2");
  assert.deepEqual(found?.tags, ["beta"]);
  assert.equal(missing, undefined);
  assert.deepEqual(targeted.map((song) => song.clipId), ["clip-2"]);
});

test("loads lightweight download verification for a batch of clips", async () => {
  const databasePath = createTempDatabasePath();
  const store = new SqliteMetadataStore(databasePath);

  await store.saveAll([
    {
      clipId: "clip-downloaded",
      title: "Downloaded",
      songUrl: "https://suno.com/song/clip-downloaded",
      liked: false,
      mp3Status: "DOWNLOADED",
      wavStatus: "PENDING",
      rawApiResponse: { id: "clip-downloaded" } as any,
    },
    {
      clipId: "clip-metadata-missing",
      title: "Metadata Missing",
      songUrl: "https://suno.com/song/clip-metadata-missing",
      liked: false,
      mp3Status: "PENDING",
    },
  ]);

  const verifications = await store.loadDownloadVerifications([
    "clip-downloaded",
    "clip-metadata-missing",
    "missing",
  ]);
  store.close();

  assert.deepEqual(
    verifications.sort((left, right) => left.clipId.localeCompare(right.clipId)),
    [
      {
        clipId: "clip-downloaded",
        hasRawApiResponse: true,
        mp3Status: "DOWNLOADED",
        wavStatus: "PENDING",
      },
      {
        clipId: "clip-metadata-missing",
        hasRawApiResponse: false,
        mp3Status: "PENDING",
        wavStatus: undefined,
      },
    ],
  );
});

test("upserts workspaces into the database", async () => {
  const databasePath = createTempDatabasePath();
  const store = new SqliteMetadataStore(databasePath);

  await store.upsertWorkspaces([
    {
      id: "workspace-1",
      name: "Drafts",
      description: "Private drafts",
      is_trashed: false,
      is_public: false,
    },
    {
      id: "workspace-2",
      name: "Released",
      description: "Public releases",
      is_trashed: false,
      is_public: true,
    },
  ]);
  await store.upsertWorkspaces([
    {
      id: "workspace-1",
      name: "New Drafts",
      description: "Updated",
      is_trashed: true,
      is_public: false,
    },
  ]);
  store.close();

  const db = new Database(databasePath);
  try {
    const rows = db
      .prepare("SELECT id, name, description, is_trashed, is_public FROM workspaces ORDER BY id")
      .all() as Array<{
        id: string;
        name: string;
        description: string;
        is_trashed: number;
        is_public: number;
      }>;
    assert.deepEqual(rows, [
      {
        id: "workspace-1",
        name: "New Drafts",
        description: "Updated",
        is_trashed: 1,
        is_public: 0,
      },
      {
        id: "workspace-2",
        name: "Released",
        description: "Public releases",
        is_trashed: 0,
        is_public: 1,
      },
    ]);
  } finally {
    db.close();
  }
});
