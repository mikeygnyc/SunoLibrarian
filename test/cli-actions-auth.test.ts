import assert from "node:assert/strict";
import test from "node:test";
import { captureAuthTokenWithDeps, getAuthenticatedClientWithDeps, type AuthDeps } from "../src/cli-actions";

type MockClient = {
  token: string;
  fetchWorkspacesPageCalls: number[];
  fetchWorkspacesPage(page?: number): Promise<any>;
};

function createAuthFailure(status: number): Error & { status: number } {
  const error = new Error(`HTTP ${status}`);
  return Object.assign(error, { status });
}

function createHarness(params: {
  cachedToken?: string | null;
  cachedTokenError?: Error & { status?: number };
  extractedToken?: string;
} = {}) {
  const clients: MockClient[] = [];
  const savedTokens: string[] = [];
  const logs: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  const deps: AuthDeps<MockClient> = {
    storage: {
      getAuthToken: () => params.cachedToken || null,
      setAuthToken: (token: string) => {
        savedTokens.push(token);
      },
    },
    createClient: (token: string) => {
      const client: MockClient = {
        token,
        fetchWorkspacesPageCalls: [],
        async fetchWorkspacesPage(page?: number) {
          this.fetchWorkspacesPageCalls.push(page || 1);
          if (token === params.cachedToken && params.cachedTokenError) {
            throw params.cachedTokenError;
          }
          return { projects: [] };
        },
      };
      clients.push(client);
      return client;
    },
    extractTokenFromBrowser: async () => params.extractedToken || "browser-token",
    log: {
      error: (message?: any) => errors.push(String(message)),
      log: (message?: any) => logs.push(String(message)),
      warn: (message?: any) => warnings.push(String(message)),
    },
  };

  return { clients, deps, errors, logs, savedTokens, warnings };
}

test("uses a cached token before other auth methods", async () => {
  const harness = createHarness({ cachedToken: "cached-token" });

  const client = await getAuthenticatedClientWithDeps(
    { token: "passed-token", browser: true },
    harness.deps,
  );

  assert.equal(client.token, "cached-token");
  assert.deepEqual(client.fetchWorkspacesPageCalls, [1]);
  assert.deepEqual(harness.savedTokens, []);
  assert.equal(harness.errors[0], "Using cached authentication token.");
});

test("falls back to passed token when cached token is rejected", async () => {
  const harness = createHarness({
    cachedToken: "cached-token",
    cachedTokenError: createAuthFailure(401),
  });

  const client = await getAuthenticatedClientWithDeps(
    { token: "passed-token" },
    harness.deps,
  );

  assert.equal(client.token, "passed-token");
  assert.deepEqual(harness.clients.map((createdClient) => createdClient.token), [
    "cached-token",
    "passed-token",
  ]);
  assert.deepEqual(harness.savedTokens, ["passed-token"]);
  assert.match(harness.warnings[0], /Cached authentication token was rejected/);
});

test("falls back to browser extraction when cached token is rejected", async () => {
  const harness = createHarness({
    cachedToken: "cached-token",
    cachedTokenError: createAuthFailure(403),
    extractedToken: "extracted-token",
  });

  const client = await getAuthenticatedClientWithDeps(
    { browser: true },
    harness.deps,
  );

  assert.equal(client.token, "extracted-token");
  assert.deepEqual(harness.savedTokens, ["extracted-token"]);
  assert.equal(harness.logs[0], "No token provided. Launching browser to extract token...");
  assert.equal(harness.logs[1], "Token extracted successfully!");
});

test("ignores cached token when requested", async () => {
  const harness = createHarness({ cachedToken: "cached-token" });

  const client = await getAuthenticatedClientWithDeps(
    { token: "passed-token", ignoreCachedToken: true },
    harness.deps,
  );

  assert.equal(client.token, "passed-token");
  assert.deepEqual(harness.clients.map((createdClient) => createdClient.token), ["passed-token"]);
  assert.deepEqual(harness.savedTokens, ["passed-token"]);
});

test("propagates non-auth cached-token failures", async () => {
  const harness = createHarness({
    cachedToken: "cached-token",
    cachedTokenError: createAuthFailure(500),
  });

  await assert.rejects(
    getAuthenticatedClientWithDeps({ token: "passed-token" }, harness.deps),
    /HTTP 500/,
  );

  assert.deepEqual(harness.savedTokens, []);
});

test("captureAuthTokenWithDeps captures and prints a token without saving by default", async () => {
  const logs: string[] = [];
  const savedTokens: string[] = [];

  const token = await captureAuthTokenWithDeps(
    {
      browser: true,
      browserProfile: "/tmp/profile-root",
      profileDirectory: "Profile 2",
    },
    {
      extractTokenFromBrowser: async (browserUrl, options) => {
        assert.equal(browserUrl, "http://localhost:9222");
        assert.equal(options?.userDataDir, "/tmp/profile-root");
        assert.equal(options?.profileDirectory, "Profile 2");
        return "captured-token";
      },
      storage: {
        setAuthToken: (value: string) => savedTokens.push(value),
      } as any,
      log: {
        log: (message?: unknown) => logs.push(String(message)),
      },
    },
  );

  assert.equal(token, "captured-token");
  assert.deepEqual(savedTokens, []);
  assert.deepEqual(logs, ["Captured token:", "captured-token"]);
});

test("captureAuthTokenWithDeps can save the token locally and emit json", async () => {
  const logs: string[] = [];
  const savedTokens: string[] = [];

  await captureAuthTokenWithDeps(
    {
      browser: "http://localhost:9333",
      saveLocal: true,
      json: true,
    },
    {
      extractTokenFromBrowser: async () => "captured-token",
      storage: {
        setAuthToken: (value: string) => savedTokens.push(value),
      } as any,
      log: {
        log: (message?: unknown) => logs.push(String(message)),
      },
    },
  );

  assert.deepEqual(savedTokens, ["captured-token"]);
  assert.deepEqual(logs, [
    "Saved captured token to the local cache.",
    JSON.stringify({ token: "captured-token" }, null, 2),
  ]);
});
