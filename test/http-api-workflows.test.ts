import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkflowSubmission } from "../src/http-api-workflows";

const SERVER_DEFAULTS = {
  downloadRoot: "/srv/suno/downloads",
  libraryRoot: "/srv/suno/library",
};

test("validateWorkflowSubmission maps sync workflow payload to normalized options", () => {
  const options = validateWorkflowSubmission("sync", {
    format: "wav",
    processExistingMetadata: true,
    formats: ["flac", "mp3"],
    bitrateKbps: 256,
    embedImages: false,
    embedLyrics: true,
    clipIds: ["clip-a", "clip-b"],
    auth: {
      browserUrl: "http://localhost:9222",
      ignoreCachedToken: true,
    },
  }, SERVER_DEFAULTS);

  assert.equal(options.output, "/srv/suno/downloads");
  assert.equal(options.library, "/srv/suno/library");
  assert.equal(options.format, "wav");
  assert.equal(options.processExistingMetadata, true);
  assert.equal(options.processFormats, "flac,mp3");
  assert.equal(options.processBitrate, "256");
  assert.equal(options.images, false);
  assert.equal(options.lyrics, true);
  assert.deepEqual(options.processClipIds, ["clip-a", "clip-b"]);
  assert.equal(options.browser, "http://localhost:9222");
  assert.equal(options.ignoreCachedToken, true);
});

test("validateWorkflowSubmission rejects server-owned workflow settings", () => {
  assert.throws(
    () => validateWorkflowSubmission("process", {
      input: "./downloads",
    }, SERVER_DEFAULTS),
    /input is managed by the server/,
  );

  assert.throws(
    () => validateWorkflowSubmission("sync", {
      output: "./downloads",
    }, SERVER_DEFAULTS),
    /output is managed by the server/,
  );

  assert.throws(
    () => validateWorkflowSubmission("sync", {
      libraryOutput: "./library",
    }, SERVER_DEFAULTS),
    /libraryOutput is managed by the server/,
  );

  assert.throws(
    () => validateWorkflowSubmission("process", {
      metadataStore: {
        type: "postgres",
        postgresUrl: "postgres://example",
      },
    }, SERVER_DEFAULTS),
    /metadataStore is managed by the server/,
  );

  assert.throws(
    () => validateWorkflowSubmission("sync", {
      delayMs: 1000,
    }, SERVER_DEFAULTS),
    /delayMs is managed by the server/,
  );

  assert.throws(
    () => validateWorkflowSubmission("process", {
      songConcurrency: 4,
    }, SERVER_DEFAULTS),
    /songConcurrency is managed by the server/,
  );
});

test("validateWorkflowSubmission maps process workflow to server-owned roots", () => {
  const options = validateWorkflowSubmission("process", {
    formats: ["flac"],
  }, SERVER_DEFAULTS);

  assert.equal(options.input, "/srv/suno/downloads");
  assert.equal(options.output, "/srv/suno/library");
  assert.equal(options.processFormats, "flac");
});

test("validateWorkflowSubmission rejects invalid download format", () => {
  assert.throws(
    () => validateWorkflowSubmission("download", { format: "flac" }, SERVER_DEFAULTS),
    /format must be one of: mp3, wav/,
  );
});

test("validateWorkflowSubmission maps fetch-metadata track ids to ids csv", () => {
  const options = validateWorkflowSubmission("fetch-metadata", {
    trackIds: ["clip-1", "clip-2"],
    workspaceId: "ws-1",
  }, SERVER_DEFAULTS);

  assert.equal(options.ids, "clip-1,clip-2");
  assert.equal(options.workspace, "ws-1");
});
