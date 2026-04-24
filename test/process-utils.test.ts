import assert from "node:assert/strict";
import test from "node:test";
import { runCommand } from "../src/process-utils";
import { CancellationError } from "../src/cancellation";

test("runCommand aborts an in-flight subprocess", async () => {
  const controller = new AbortController();
  const command = process.execPath;
  const args = ["-e", "setTimeout(() => process.exit(0), 5000)"];

  const promise = runCommand(command, args, { signal: controller.signal });
  setTimeout(() => {
    controller.abort(new CancellationError("subprocess cancelled"));
  }, 50);

  await assert.rejects(
    () => promise,
    (error: unknown) => error instanceof CancellationError && error.message === "subprocess cancelled",
  );
});
