import assert from "node:assert/strict";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import test from "node:test";
import { SunoClient } from "../src/client";

test("refreshes once after concurrent 401 responses and retries with the new token", async (t) => {
  const authorizations: string[] = [];
  const server = http.createServer((request, response) => {
    const authorization = String(request.headers.authorization || "");
    authorizations.push(authorization);
    if (authorization === "Bearer expired-token") {
      response.writeHead(401);
      response.end("expired");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address();
  assert(address && typeof address === "object");
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "suno-client-auth-refresh-"));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));

  let refreshCalls = 0;
  const client = new SunoClient(
    "expired-token",
    "test-device",
    undefined,
    undefined,
    undefined,
    cacheDir,
    undefined,
    async (rejectedToken) => {
      refreshCalls += 1;
      assert.equal(rejectedToken, "expired-token");
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "fresh-token";
    },
  );

  const makeRequest = (client as any).makeRequest.bind(client) as (url: string) => Promise<any>;
  const url = `http://127.0.0.1:${address.port}/resource`;
  const responses = await Promise.all([makeRequest(url), makeRequest(url)]);

  assert.deepEqual(await Promise.all(responses.map((response) => response.json())), [
    { ok: true },
    { ok: true },
  ]);
  assert.equal(refreshCalls, 1);
  assert.equal(client.getAuthToken(), "fresh-token");
  assert.equal(authorizations.filter((value) => value === "Bearer expired-token").length, 2);
  assert.equal(authorizations.filter((value) => value === "Bearer fresh-token").length, 2);
});

test("retries a 401 only once after refreshing", async (t) => {
  let requestCount = 0;
  const server = http.createServer((_request, response) => {
    requestCount += 1;
    response.writeHead(401);
    response.end("still unauthorized");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address();
  assert(address && typeof address === "object");
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "suno-client-auth-retry-"));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));

  let refreshCalls = 0;
  const client = new SunoClient(
    "expired-token",
    "test-device",
    undefined,
    undefined,
    undefined,
    cacheDir,
    undefined,
    async () => {
      refreshCalls += 1;
      return "fresh-token";
    },
  );
  const makeRequest = (client as any).makeRequest.bind(client) as (url: string) => Promise<any>;

  await assert.rejects(
    makeRequest(`http://127.0.0.1:${address.port}/resource`),
    (error: any) => error?.status === 401 && /still unauthorized/.test(error.message),
  );
  assert.equal(refreshCalls, 1);
  assert.equal(requestCount, 2);
});
