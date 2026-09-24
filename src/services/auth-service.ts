import {
  extractTokenFromBrowser,
  resolveBrowserEndpoint,
  resolveBrowserProfileDirectory,
  resolveBrowserUserDataDir,
} from "../lib/auth/auth";
import { getSharedAuthToken, setSharedAuthToken } from "../orchestration/auth-token-store";
import { SunoClient, type AuthTokenRefresher } from "../client";
import { Storage } from "../storage";

export interface CliOptions {
  [key: string]: any;
  apiUrl?: string;
  browser?: string | boolean;
  browserProfile?: string;
  cacheDir?: string;
  config?: string;
  controlPlane?: string;
  database?: string;
  databaseType?: string;
  delay?: string | number;
  disabledWorkspaces?: string[];
  downloadClipIds?: string[];
  host?: string;
  enabledWorkspaces?: string[];
  ignoreCachedToken?: boolean;
  interval?: string | number;
  jobId?: string;
  json?: boolean;
  librarianInterval?: string | number;
  library?: string;
  level?: string;
  limit?: string | number;
  list?: string;
  logFile?: string;
  mqttTopicPrefix?: string;
  mqttUrl?: string;
  localRoot?: string;
  once?: boolean;
  output?: string;
  payload?: string;
  pollInterval?: string | number;
  port?: string | number;
  postgresUrl?: string;
  priority?: string | number;
  processConcurrency?: string | number;
  processUpdateConcurrency?: string | number;
  batchSize?: string | number;
  profileDirectory?: string;
  reason?: string;
  role?: string;
  sendToApi?: boolean;
  startTime?: string;
  stageId?: string;
  token?: string;
  workerInstanceId?: string;
  workflowType?: string;
  workItemId?: string;
  workspace?: string;
  librarianManagedSync?: boolean;
  __jobId?: string;
  __requireResolvedAuth?: boolean;
  __abortSignal?: AbortSignal;
  __authenticatedClient?: SunoClient;
  __storage?: {
    clearCache?: () => void;
  };
  onTrackDownloaded?: (params: { clipId: string; outputDir: string }) => void | Promise<void>;
}

export type AuthStorage = Pick<Storage, "getAuthToken" | "setAuthToken">;

export type AuthClient = {
  fetchWorkspacesPage(page?: number): Promise<any>;
};

export type AuthDeps<TClient extends AuthClient> = {
  storage: AuthStorage;
  createClient: (
    token: string,
    browserEndpoint?: string,
    browserUserDataDir?: string,
    browserProfileDirectory?: string,
    cacheDir?: string,
    abortSignal?: AbortSignal,
    authTokenRefresher?: AuthTokenRefresher,
  ) => TClient;
  extractTokenFromBrowser: typeof extractTokenFromBrowser;
  log: Pick<Console, "error" | "log" | "warn">;
};

export class AuthService {
  async getAuthenticatedClient(options: CliOptions): Promise<SunoClient> {
    if (options.__authenticatedClient) {
      return options.__authenticatedClient as SunoClient;
    }

    return getAuthenticatedClientWithDeps(options, {
      storage: new Storage({ cacheDir: options.cacheDir }),
      createClient,
      extractTokenFromBrowser,
      log: console,
    });
  }
}

export async function getAuthenticatedClientWithDeps<TClient extends AuthClient>(
  options: CliOptions,
  deps: AuthDeps<TClient>,
): Promise<TClient> {
  const browserEndpoint = resolveBrowserEndpoint(options);
  const browserUserDataDir = resolveBrowserUserDataDir(options);
  const browserProfileDirectory = resolveBrowserProfileDirectory(options);
  const requireResolvedAuth = options.__requireResolvedAuth === true;
  const authTokenRefresher = createAuthTokenRefresher(options, deps, {
    browserEndpoint,
    browserUserDataDir,
    browserProfileDirectory,
  });

  if (requireResolvedAuth) {
    const resolvedToken = typeof options.token === "string" && options.token.trim().length > 0
      ? options.token.trim()
      : undefined;

    if (!resolvedToken) {
      throw new Error(
        [
          "Distributed auth handoff missing resolved token.",
          "This worker is not allowed to resolve auth locally.",
          "Run the authorization stage first and pass its resolved auth to downstream stages.",
        ].join("\n"),
      );
    }

    return deps.createClient(
      resolvedToken,
      browserEndpoint,
      browserUserDataDir,
      browserProfileDirectory,
      options.cacheDir,
      options.__abortSignal,
      authTokenRefresher,
    );
  }

  const ignoreCachedToken = options.ignoreCachedToken === true;
  if (!ignoreCachedToken) {
    const cachedToken = deps.storage.getAuthToken();
    if (cachedToken) {
      const cachedClient = deps.createClient(
        cachedToken,
        browserEndpoint,
        browserUserDataDir,
        browserProfileDirectory,
        options.cacheDir,
        options.__abortSignal,
        authTokenRefresher,
      );

      try {
        await cachedClient.fetchWorkspacesPage(1);
        deps.log.error("Using cached authentication token.");
        return cachedClient;
      } catch (error: any) {
        if (!isAuthFailure(error)) {
          throw error;
        }
        deps.log.warn("Cached authentication token was rejected. Falling back to configured auth method.");
      }
    }

    const sharedToken = await getSharedAuthToken({ postgresUrl: options.postgresUrl });
    if (sharedToken && sharedToken !== cachedToken) {
      const sharedClient = deps.createClient(
        sharedToken,
        browserEndpoint,
        browserUserDataDir,
        browserProfileDirectory,
        options.cacheDir,
        options.__abortSignal,
        authTokenRefresher,
      );

      try {
        await sharedClient.fetchWorkspacesPage(1);
        deps.storage.setAuthToken(sharedToken);
        deps.log.log("Using shared authentication token from control plane.");
        return sharedClient;
      } catch (error: any) {
        if (!isAuthFailure(error)) {
          throw error;
        }
        deps.log.warn("Shared authentication token from control plane was rejected. Falling back to configured auth method.");
      }
    }
  }

  if (!options.token && !browserEndpoint) {
    throw new Error(
      [
        "Authentication required: provide either --token or --browser",
        `Resolved auth inputs: token=${describeTokenPresence(options.token)}, browser=${describeBrowserOption(options.browser)}, browserEndpoint=${browserEndpoint ?? "undefined"}`,
      ].join("\n"),
    );
  }

  let token = options.token;
  if (token) {
    const explicitClient = deps.createClient(
      token,
      browserEndpoint,
      browserUserDataDir,
      browserProfileDirectory,
      options.cacheDir,
      options.__abortSignal,
      authTokenRefresher,
    );

    try {
      await explicitClient.fetchWorkspacesPage(1);
      deps.log.log("Using explicit authentication token.");
      deps.storage.setAuthToken(token);
      await setSharedAuthToken({ postgresUrl: options.postgresUrl }, token);
      return explicitClient;
    } catch (error: any) {
      if (!isAuthFailure(error)) {
        throw error;
      }
      deps.log.warn("Explicit authentication token was rejected by Suno.");
      token = undefined;
    }
  }

  if (!token) {
    deps.log.log("No token provided. Launching browser to extract token...");
    token = await deps.extractTokenFromBrowser(browserEndpoint, {
      userDataDir: browserUserDataDir,
      profileDirectory: browserProfileDirectory,
      abortSignal: options.__abortSignal,
    });
    deps.log.log("Token extracted successfully!");
  }

  const extractedClient = deps.createClient(
    token,
    browserEndpoint,
    browserUserDataDir,
    browserProfileDirectory,
    options.cacheDir,
    options.__abortSignal,
    authTokenRefresher,
  );
  await extractedClient.fetchWorkspacesPage(1);
  deps.storage.setAuthToken(token);
  await setSharedAuthToken({ postgresUrl: options.postgresUrl }, token);
  return extractedClient;
}

function createClient(
  token: string,
  browserEndpoint?: string,
  browserUserDataDir?: string,
  browserProfileDirectory?: string,
  cacheDir?: string,
  abortSignal?: AbortSignal,
  authTokenRefresher?: AuthTokenRefresher,
): SunoClient {
  return new SunoClient(
    token,
    undefined,
    browserEndpoint,
    browserUserDataDir,
    browserProfileDirectory,
    cacheDir,
    abortSignal,
    authTokenRefresher,
  );
}

function createAuthTokenRefresher<TClient extends AuthClient>(
  options: CliOptions,
  deps: AuthDeps<TClient>,
  browser: {
    browserEndpoint?: string;
    browserUserDataDir?: string;
    browserProfileDirectory?: string;
  },
): AuthTokenRefresher | undefined {
  if (!browser.browserEndpoint && !options.postgresUrl) return undefined;

  return async (rejectedToken: string): Promise<string> => {
    const sharedToken = await getSharedAuthToken({ postgresUrl: options.postgresUrl });
    if (sharedToken && sharedToken !== rejectedToken) {
      deps.storage.setAuthToken(sharedToken);
      deps.log.log("Using refreshed authentication token from control plane.");
      return sharedToken;
    }

    if (!browser.browserEndpoint) {
      throw new Error("Authentication refresh failed after HTTP 401: no newer shared token is available");
    }

    const token = await deps.extractTokenFromBrowser(browser.browserEndpoint, {
      userDataDir: browser.browserUserDataDir,
      profileDirectory: browser.browserProfileDirectory,
      abortSignal: options.__abortSignal,
    });
    deps.storage.setAuthToken(token);
    await setSharedAuthToken({ postgresUrl: options.postgresUrl }, token);
    deps.log.log("Captured and saved a fresh authentication token after HTTP 401.");
    return token;
  };
}

function isAuthFailure(error: any): boolean {
  return error?.status === 401 || error?.status === 403;
}

function describeTokenPresence(token: CliOptions["token"]): string {
  return typeof token === "string" && token.trim().length > 0 ? "[provided]" : "[missing]";
}

function describeBrowserOption(browser: CliOptions["browser"]): string {
  if (browser === true) return "true";
  if (browser === false) return "false";
  if (typeof browser === "string") {
    const trimmed = browser.trim();
    return trimmed.length > 0 ? trimmed : '""';
  }
  return String(browser);
}
