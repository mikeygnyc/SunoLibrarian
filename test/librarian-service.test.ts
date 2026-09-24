import assert from "node:assert/strict";
import test from "node:test";
import { LibrarianService } from "../src/services/librarian-service";

test("LibrarianService requires a pinned workspace for each cycle", async () => {
  const service = new LibrarianService();

  await assert.rejects(
    service.runSingleWorkspaceCycle({}),
    /run-librarian requires --workspace/,
  );
});

test("LibrarianService skips a pinned workspace disabled by policy", async () => {
  const service = new LibrarianService();
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));

  try {
    const synced = await service.runSingleWorkspaceCycle({
      workspace: "ws-2",
      disabledWorkspaces: ["ws-2"],
    });
    assert.equal(synced, false);
  } finally {
    console.log = originalLog;
  }

  assert.ok(logs.some((line) => line.includes("Skipping workspace ws-2")));
});
