import { strict as assert } from "assert";
import test from "node:test";
import { HttpApiClient, HttpApiClientError } from "../src/http-api-client";

test("HttpApiClient submits workflow payloads to the validated workflow endpoint", async () => {
  let requestUrl = "";
  let requestInit: { method?: string; body?: string } | undefined;
  const client = new HttpApiClient({
    baseUrl: "http://example.test/",
    fetchImpl: async (url, init) => {
      requestUrl = url;
      requestInit = {
        method: init?.method,
        body: typeof init?.body === "string" ? init.body : undefined,
      };
      return {
        ok: true,
        status: 202,
        async json() {
          return {
            jobId: "job-123",
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

  const response = await client.submitWorkflow("process", {
    formats: ["flac", "mp3"],
  });

  assert.equal(requestUrl, "http://example.test/api/v1/workflows/process");
  assert.equal(requestInit?.method, "POST");
  assert.deepEqual(JSON.parse(requestInit?.body ?? "{}"), {
    formats: ["flac", "mp3"],
  });
  assert.equal(response.jobId, "job-123");
});

test("HttpApiClient serializes log query filters into query params", async () => {
  let requestUrl = "";
  const client = new HttpApiClient({
    baseUrl: "http://example.test",
    fetchImpl: async (url) => {
      requestUrl = url;
      return {
        ok: true,
        status: 200,
        async json() {
          return { entries: [] };
        },
        async text() {
          return "";
        },
      };
    },
  });

  await client.queryLogs({
    jobId: "job-42",
    workflowType: "sync",
    startTime: new Date("2025-01-02T03:04:05.000Z"),
    limit: 50,
  });

  assert.equal(
    requestUrl,
    "http://example.test/api/v1/logs?jobId=job-42&workflowType=sync&startTime=2025-01-02T03%3A04%3A05.000Z&limit=50",
  );
});

test("HttpApiClient throws typed errors for non-ok API responses", async () => {
  const client = new HttpApiClient({
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      async json() {
        return { error: "Job not found: job-404" };
      },
      async text() {
        return "";
      },
    }),
  });

  await assert.rejects(
    () => client.getJob("job-404"),
    (error: unknown) => {
      assert.ok(error instanceof HttpApiClientError);
      assert.equal(error.statusCode, 404);
      assert.equal(error.message, "Job not found: job-404");
      return true;
    },
  );
});
