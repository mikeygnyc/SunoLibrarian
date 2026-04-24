import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { inferProcessTargetClipIdsFromRoots } from "../src/library-processor";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("inferProcessTargetClipIdsFromRoots discovers clip ids from input and output artifacts", () => {
  const inputRoot = createTempDir("suno-export-input-");
  const outputRoot = createTempDir("suno-export-output-");

  fs.mkdirSync(path.join(inputRoot, "metadata"), { recursive: true });
  fs.mkdirSync(path.join(outputRoot, "flac"), { recursive: true });
  fs.mkdirSync(path.join(outputRoot, "mp3"), { recursive: true });

  fs.writeFileSync(path.join(inputRoot, "metadata", "clip-a.json"), "{}", "utf8");
  fs.writeFileSync(path.join(outputRoot, "flac", "clip-b.flac"), "", "utf8");
  fs.writeFileSync(path.join(outputRoot, "mp3", "clip-a.mp3"), "", "utf8");
  fs.mkdirSync(path.join(outputRoot, "mp3", "nested"), { recursive: true });
  fs.writeFileSync(path.join(outputRoot, "mp3", "nested", "clip-c.mp3"), "", "utf8");

  const clipIds = inferProcessTargetClipIdsFromRoots(inputRoot, outputRoot);

  assert.deepEqual(Array.from(clipIds).sort(), ["clip-a", "clip-b"]);
});
