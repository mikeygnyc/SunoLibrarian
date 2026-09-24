import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { runApiSubmitWorkflowFlow, runJobStatusFlow } from "../src/cli-actions";

test("runApiSubmitWorkflowFlow reads payload JSON and submits the selected workflow", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "suno-export-api-cli-"));
  const payloadPath = path.join(tempDir, "process.json");
  fs.writeFileSync(payloadPath, JSON.stringify({
    formats: ["flac", "mp3"],
  }));

  const calls: Array<{ workflow: string; payload: Record<string, unknown> }> = [];
  const capturedLogs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    capturedLogs.push(args.map((arg) => String(arg)).join(" "));
  };

  try {
    await runApiSubmitWorkflowFlow("process", {
      payload: payloadPath,
      __apiClient: {
        async submitWorkflow(workflow: string, payload: Record<string, unknown>) {
          calls.push({ workflow, payload });
          return {
            jobId: "job-123",
            workflowType: "process",
            status: "queued",
          };
        },
      },
    });
  } finally {
    console.log = originalLog;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].workflow, "process");
  assert.deepEqual(calls[0].payload, {
    formats: ["flac", "mp3"],
  });
  assert.ok(capturedLogs.some((line) => line.includes("Job submitted: job-123")));
});

test("runJobStatusFlow prints formatted remote job status", async () => {
  const capturedLogs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    capturedLogs.push(args.map((arg) => String(arg)).join(" "));
  };

  try {
    await runJobStatusFlow("job-77", {
      __apiClient: {
        async getJob() {
          return {
            job: {
              id: "job-77",
              workflowType: "sync",
              status: "running",
              runtimeMode: "distributed",
              payload: {},
              createdAt: new Date("2026-04-23T00:00:00.000Z"),
              updatedAt: new Date("2026-04-23T00:01:00.000Z"),
              startedAt: new Date("2026-04-23T00:01:00.000Z"),
            },
            stages: [
              {
                id: "stage-1",
                jobId: "job-77",
                stageType: "asset-acquisition",
                status: "running",
                sequence: 2,
                createdAt: new Date("2026-04-23T00:00:00.000Z"),
                updatedAt: new Date("2026-04-23T00:01:00.000Z"),
              },
            ],
            workItems: [],
            leases: [],
            workers: [],
            events: [],
          };
        },
      },
    });
  } finally {
    console.log = originalLog;
  }

  assert.ok(capturedLogs.some((line) => line.includes("Job job-77")));
  assert.ok(capturedLogs.some((line) => line.includes("Workflow: sync")));
  assert.ok(capturedLogs.some((line) => line.includes("2. asset-acquisition [running]")));
});
