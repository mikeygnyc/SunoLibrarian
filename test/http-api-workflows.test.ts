import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkflowSubmission } from "../src/http-api-workflows";

test("validateWorkflowSubmission maps sync workflow payload to normalized options", () => {
  const options = validateWorkflowSubmission("sync", {
    output: "./downloads",
    libraryOutput: "./library",
    format: "wav",
    delayMs: 1500,
    processExistingMetadata: true,
    formats: ["flac", "mp3"],
    bitrateKbps: 256,
    songConcurrency: 2,
    updateConcurrency: 4,
    embedImages: false,
    embedLyrics: true,
    clipIds: ["clip-a", "clip-b"],
    auth: {
      browserUrl: "http://localhost:9222",
      ignoreCachedToken: true,
    },
    metadataStore: {
      type: "sqlite",
      sqlitePath: "./data/metadata.sqlite",
    },
  });

  assert.equal(options.output, "./downloads");
  assert.equal(options.library, "./library");
  assert.equal(options.format, "wav");
  assert.equal(options.delay, "1500");
  assert.equal(options.processExistingMetadata, true);
  assert.equal(options.processFormats, "flac,mp3");
  assert.equal(options.processBitrate, "256");
  assert.equal(options.processConcurrency, "2");
  assert.equal(options.processUpdateConcurrency, "4");
  assert.equal(options.images, false);
  assert.equal(options.lyrics, true);
  assert.deepEqual(options.processClipIds, ["clip-a", "clip-b"]);
  assert.equal(options.browser, "http://localhost:9222");
  assert.equal(options.ignoreCachedToken, true);
  assert.equal(options.databaseType, "sqlite");
  assert.equal(options.database, "./data/metadata.sqlite");
});

test("validateWorkflowSubmission requires process input and output", () => {
  assert.throws(
    () => validateWorkflowSubmission("process", { output: "./out" }),
    /input is required/,
  );
});

test("validateWorkflowSubmission rejects invalid download format", () => {
  assert.throws(
    () => validateWorkflowSubmission("download", { format: "flac" }),
    /format must be one of: mp3, wav/,
  );
});

test("validateWorkflowSubmission maps fetch-metadata track ids to ids csv", () => {
  const options = validateWorkflowSubmission("fetch-metadata", {
    trackIds: ["clip-1", "clip-2"],
    workspaceId: "ws-1",
  });

  assert.equal(options.ids, "clip-1,clip-2");
  assert.equal(options.workspace, "ws-1");
});
