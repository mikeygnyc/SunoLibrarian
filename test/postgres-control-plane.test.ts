import assert from "node:assert/strict";
import test from "node:test";
import { buildLogQuery } from "../src/orchestration";
import { DatabaseLogSink, LogQueryService } from "../src/logging";
import type { ICentralLogRepository, ILogEntry, ILogQueryFilter } from "../src/lib/interfaces";

class InMemoryLogRepository implements ICentralLogRepository {
  private readonly entries: ILogEntry[] = [];

  async initialize(): Promise<void> {}

  async close(): Promise<void> {}

  async write(entry: ILogEntry): Promise<void> {
    this.entries.push(entry);
  }

  async query(filter: ILogQueryFilter = {}): Promise<{ entries: ILogEntry[] }> {
    const entries = this.entries.filter((entry) => {
      const context = entry.context ?? {};
      if (filter.jobId && context.jobId !== filter.jobId) return false;
      if (filter.role && context.role !== filter.role) return false;
      if (filter.clipId && context.clipId !== filter.clipId) return false;
      if (filter.level && entry.level !== filter.level) return false;
      return true;
    });

    return { entries };
  }
}

test("buildLogQuery includes common structured log filters", () => {
  const built = buildLogQuery({
    jobId: "job-1",
    role: "metadata",
    clipId: "clip-77",
    level: "warn",
  });

  assert.match(built.clauseSql, /context_json->>'jobId' = \$1/);
  assert.match(built.clauseSql, /context_json->>'role' = \$2/);
  assert.match(built.clauseSql, /context_json->>'clipId' = \$3/);
  assert.match(built.clauseSql, /level = \$4/);
  assert.deepEqual(built.params, ["job-1", "metadata", "clip-77", "warn"]);
});

test("DatabaseLogSink writes entries and LogQueryService returns filtered results", async () => {
  const repository = new InMemoryLogRepository();
  const sink = new DatabaseLogSink(repository);
  const queryService = new LogQueryService(repository);

  await sink.write({
    timestamp: new Date("2026-04-23T00:00:00.000Z"),
    level: "info",
    message: "metadata started",
    context: {
      jobId: "job-1",
      role: "metadata",
      clipId: "clip-1",
    },
  });

  await sink.write({
    timestamp: new Date("2026-04-23T00:01:00.000Z"),
    level: "error",
    message: "asset failed",
    context: {
      jobId: "job-2",
      role: "asset",
      clipId: "clip-2",
    },
  });

  const filtered = await queryService.query({
    jobId: "job-1",
    role: "metadata",
  });

  assert.equal(filtered.entries.length, 1);
  assert.equal(filtered.entries[0]?.message, "metadata started");
});
