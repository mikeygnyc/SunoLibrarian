import assert from "node:assert/strict";
import test from "node:test";
import { DashboardApiAdapter } from "../src/http-api-dashboard";

test("DashboardApiAdapter maps job details into dashboard-friendly view data", async () => {
  const adapter = new DashboardApiAdapter({
    fetchImpl: async (url) => {
      assert.equal(url, "http://127.0.0.1:3000/api/v1/jobs/job-9");
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            job: {
              id: "job-9",
              workflowType: "sync",
              status: "running",
              runtimeMode: "distributed",
              payload: {},
              createdAt: "2026-04-23T00:00:00.000Z",
              updatedAt: "2026-04-23T00:02:00.000Z",
              startedAt: "2026-04-23T00:01:00.000Z",
            },
            stages: [
              {
                id: "stage-1",
                jobId: "job-9",
                stageType: "authorization",
                status: "succeeded",
                sequence: 1,
                createdAt: "2026-04-23T00:00:00.000Z",
                updatedAt: "2026-04-23T00:00:30.000Z",
                completedAt: "2026-04-23T00:00:30.000Z",
              },
              {
                id: "stage-2",
                jobId: "job-9",
                stageType: "asset-acquisition",
                status: "running",
                sequence: 2,
                createdAt: "2026-04-23T00:00:30.000Z",
                updatedAt: "2026-04-23T00:02:00.000Z",
                startedAt: "2026-04-23T00:01:00.000Z",
              },
            ],
            workItems: [
              {
                id: "item-1",
                stageId: "stage-2",
                status: "running",
                attemptCount: 1,
                clipId: "clip-1",
                createdAt: "2026-04-23T00:00:30.000Z",
                updatedAt: "2026-04-23T00:02:00.000Z",
              },
              {
                id: "item-2",
                stageId: "stage-2",
                status: "pending",
                attemptCount: 0,
                clipId: "clip-2",
                createdAt: "2026-04-23T00:00:30.000Z",
                updatedAt: "2026-04-23T00:00:30.000Z",
              },
            ],
            statusEvents: [
              {
                id: "event-1",
                scope: "job",
                scopeId: "job-9",
                message: "asset acquisition is active",
                createdAt: "2026-04-23T00:02:00.000Z",
              },
            ],
          };
        },
        async text() {
          return "";
        },
      };
    },
  });

  const details = await adapter.getJobDetails("job-9");

  assert.equal(details.job.id, "job-9");
  assert.equal(details.job.activeStage, "asset-acquisition");
  assert.equal(details.job.stageCounts.running, 1);
  assert.equal(details.job.stageCounts.succeeded, 1);
  assert.equal(details.stages[1].workItemCounts.running, 1);
  assert.equal(details.stages[1].workItemCounts.pending, 1);
  assert.equal(details.logsHref, "/api/v1/logs?jobId=job-9");
  assert.equal(details.latestStatusMessage, "asset acquisition is active");
});

test("DashboardApiAdapter exposes workflow-specific submit helpers", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const adapter = new DashboardApiAdapter({
    baseUrl: "http://example.test",
    fetchImpl: async (url, init) => {
      calls.push({
        url,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      return {
        ok: true,
        status: 202,
        async json() {
          return {
            jobId: "job-11",
            workflowType: "process",
            status: "queued",
          };
        },
        async text() {
          return "";
        },
      };
    },
  });

  const result = await adapter.submitProcessWorkflow({
    formats: ["flac"],
  });

  assert.equal(result.jobId, "job-11");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://example.test/api/v1/workflows/process");
  assert.deepEqual(calls[0].body, {
    formats: ["flac"],
  });
});

test("DashboardApiAdapter maps log entries into display-friendly summaries", async () => {
  const adapter = new DashboardApiAdapter({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          entries: [
            {
              id: "log-1",
              timestamp: "2026-04-23T00:03:00.000Z",
              level: "warn",
              message: "lease contention detected",
              context: {
                workflowType: "sync",
                role: "asset",
                jobId: "job-9",
              },
            },
          ],
        };
      },
      async text() {
        return "";
      },
    }),
  });

  const result = await adapter.queryLogs({ jobId: "job-9" });

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].summary, "WARN | sync | asset | job-9 | lease contention detected");
});
