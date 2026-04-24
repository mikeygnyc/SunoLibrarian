import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { CancellationError } from "../src/cancellation";
import { Processor } from "../src/library-processor";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("processor respects cooperative cancellation hook", async () => {
  const inputRoot = createTempDir("suno-export-cancel-in-");
  const outputRoot = createTempDir("suno-export-cancel-out-");
  const databaseDir = createTempDir("suno-export-cancel-db-");
  const metadataDatabasePath = path.join(databaseDir, "metadata.sqlite");

  const processor = new Processor({
    inputRoot,
    outputRoot,
    metadataDatabasePath,
    formats: ["flac", "mp3", "alac"],
    mp3Bitrate: 320,
    embedImages: true,
    embedLyrics: true,
    exitOnError: false,
    assertNotCancelled: () => {
      throw new CancellationError("cancelled during processor run");
    },
  });

  await assert.rejects(
    () => processor.process(),
    (error: unknown) => error instanceof CancellationError && error.message === "cancelled during processor run",
  );
});
